-- ModuleScript: keep this under ServerScriptService. Never expose the game key to clients.

local HttpService = game:GetService("HttpService")

local BASE_URL = "https://api.bookscover.store/v1"
local GAME_API_KEY = "PASTE_YOUR_GAME_API_KEY_HERE"
local MAX_ATTEMPTS = 4

local BookscoverAPI = {}

function BookscoverAPI.isConfigured()
	return GAME_API_KEY ~= "PASTE_YOUR_GAME_API_KEY_HERE" and #GAME_API_KEY >= 32
end

function BookscoverAPI.syncGameState(userId: number, state: {[string]: any})
	if not BookscoverAPI.isConfigured() then
		return false, 0, {error = {code = "not_configured"}}
	end

	local url = BASE_URL .. "/game/players/" .. tostring(userId) .. "/state"
	local body = HttpService:JSONEncode(state)
	for attempt = 1, MAX_ATTEMPTS do
		local requestOk, response = pcall(function()
			return HttpService:RequestAsync({
				Url = url,
				Method = "POST",
				Headers = {
					["Authorization"] = "Bearer " .. GAME_API_KEY,
					["Content-Type"] = "application/json",
					["Accept"] = "application/json",
				},
				Body = body,
			})
		end)

		if requestOk then
			local decoded
			if response.Body and response.Body ~= "" then
				local decodeOk, result = pcall(function()
					return HttpService:JSONDecode(response.Body)
				end)
				if decodeOk then
					decoded = result
				end
			end

			if response.Success then
				return true, response.StatusCode, decoded
			end
			if response.StatusCode ~= 429 and response.StatusCode < 500 then
				return false, response.StatusCode, decoded
			end
		elseif attempt == MAX_ATTEMPTS then
			warn("[BookscoverAPI] request failed:", response)
			return false, 0, nil
		end

		if attempt < MAX_ATTEMPTS then
			task.wait(math.min(2 ^ (attempt - 1), 8))
		end
	end

	return false, 0, nil
end

return BookscoverAPI-- ModuleScript: place in ServerScriptService. SERVER ONLY.
-- Never move this into ReplicatedStorage or StarterPlayerScripts, or the game key becomes visible to clients.

local HttpService = game:GetService("HttpService")

local BASE_URL = "https://api.bookscover.store/v1"
local GAME_API_KEY = "PASTE_YOUR_GAME_API_KEY_HERE" -- set this to your GAME_API_KEY value

local MAX_ATTEMPTS = 4
local BASE_DELAY_SECONDS = 1

if GAME_API_KEY == "PASTE_YOUR_GAME_API_KEY_HERE" then
	error("BookscoverAPI: set GAME_API_KEY before publishing the game")
end

local BookscoverAPI = {}

local function buildHeaders(extra)
	local headers = {
		["Authorization"] = "Bearer " .. GAME_API_KEY,
		["Content-Type"] = "application/json",
		["Accept"] = "application/json",
	}
	if extra then
		for k, v in pairs(extra) do
			headers[k] = v
		end
	end
	return headers
end

-- Returns: success (bool), statusCode (number), decodedBody (table or nil)
-- Retries network failures, HTTP 429, and 5xx with exponential backoff and jitter.
-- Never retries other 4xx responses; those are real answers.
-- Extra headers (like Idempotency-Key) are built once by the caller, so every retry reuses them.
local function request(method, path, body, extraHeaders)
	local headers = buildHeaders(extraHeaders)
	local encodedBody = nil
	if body then
		encodedBody = HttpService:JSONEncode(body)
	end

	for attempt = 1, MAX_ATTEMPTS do
		local ok, response = pcall(function()
			return HttpService:RequestAsync({
				Url = BASE_URL .. path,
				Method = method,
				Headers = headers,
				Body = encodedBody,
			})
		end)

		if ok then
			local decoded = nil
			if response.Body and response.Body ~= "" then
				local decodeOk, result = pcall(function()
					return HttpService:JSONDecode(response.Body)
				end)
				if decodeOk then
					decoded = result
				end
			end

			if response.Success then
				return true, response.StatusCode, decoded
			end

			local retryable = response.StatusCode == 429 or response.StatusCode >= 500
			if not retryable or attempt == MAX_ATTEMPTS then
				return false, response.StatusCode, decoded
			end
		else
			warn(`[BookscoverAPI] {method} {path} network error (attempt {attempt}): {response}`)
			if attempt == MAX_ATTEMPTS then
				return false, 0, nil
			end
		end

		task.wait(BASE_DELAY_SECONDS * 2 ^ (attempt - 1) * (0.8 + math.random() * 0.4))
	end

	return false, 0, nil
end

-- Call when a player joins. Creates the player record on first visit and starts AFK timing.
-- Returns: ok, status, data. A 403 status means the player is banned.
function BookscoverAPI.startSession(userId: number, username: string)
	return request("POST", "/game/players/" .. tostring(userId) .. "/session", { username = username })
end

-- Call every AFK tick (for example, every 60 seconds) per player.
-- The server computes the award from its own clock. Do not send amounts from the game.
-- Returns: ok, status, data where data.awarded is the points granted this call.
function BookscoverAPI.awardAfk(userId: number)
	return request("POST", "/game/players/" .. tostring(userId) .. "/afk")
end

-- Redeem a catalog item. Generates ONE idempotency key per call and reuses it on retries,
-- so a timeout followed by a retry can never charge the player twice.
function BookscoverAPI.redeemItem(userId: number, itemId: number)
	local idempotencyKey = string.gsub(HttpService:GenerateGUID(false), "-", "")
	return request(
		"POST",
		"/game/players/" .. tostring(userId) .. "/redeem",
		{ itemId = tostring(itemId) },
		{ ["Idempotency-Key"] = idempotencyKey }
	)
end

-- Public read: current points, inventory, and ban status.
function BookscoverAPI.getPlayer(userId: number)
	return request("GET", "/players/" .. tostring(userId))
end

-- Public read: game config and active catalog prices.
function BookscoverAPI.getConfig()
	return request("GET", "/config")
end

return BookscoverAPI
