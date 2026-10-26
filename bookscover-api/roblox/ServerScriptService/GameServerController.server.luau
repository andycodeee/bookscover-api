-- Script: place in ServerScriptService. SERVER ONLY.
-- Handles session start, AFK points, and item redemption requests from clients.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local BookscoverAPI = require(script.Parent.BookscoverAPI)

local AFK_TICK_SECONDS = 60
local REDEEM_COOLDOWN_SECONDS = 2

-- Stop a player whose account is banned on the backend.
local function enforceBan(player, status)
	if status == 403 and player.Parent then
		player:Kick("This account is restricted.")
		return true
	end
	return false
end

local function onPlayerAdded(player)
	local ok, status, data = BookscoverAPI.startSession(player.UserId, player.Name)
	if enforceBan(player, status) then
		return
	end
	if not ok then
		warn(`[Bookscover] session failed for {player.UserId}: {status}`)
	end
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

-- AFK accrual loop. One request per player per tick, each in its own thread
-- so a slow request never delays the others.
task.spawn(function()
	while true do
		task.wait(AFK_TICK_SECONDS)
		for _, player in Players:GetPlayers() do
			task.spawn(function()
				local ok, status = BookscoverAPI.awardAfk(player.UserId)
				if not ok and enforceBan(player, status) then
					return
				end
			end)
		end
	end
end)

-- Redemption via RemoteFunction. The client sends only an itemId, which the server validates.
local redeemRemote = Instance.new("RemoteFunction")
redeemRemote.Name = "RedeemItem"
redeemRemote.Parent = ReplicatedStorage

local lastRedeemAt = {}

-- Replace this with however your game delivers the item to the player.
-- See the README "Item delivery" section before implementing.
local function deliverItem(player: Player, itemId: number): boolean
	warn(`[Bookscover] item {itemId} redeemed by {player.Name}; deliver it using your chosen method`)
	return true
end

redeemRemote.OnServerInvokeFunction = function(player: Player, itemId)
	if typeof(itemId) ~= "number" or itemId % 1 ~= 0 or itemId <= 0 then
		return { ok = false, reason = "invalid_item" }
	end

	local now = os.clock()
	if lastRedeemAt[player] and now - lastRedeemAt[player] < REDEEM_COOLDOWN_SECONDS then
		return { ok = false, reason = "cooldown" }
	end
	lastRedeemAt[player] = now

	local ok, status, data = BookscoverAPI.redeemItem(player.UserId, itemId)
	if not ok then
		if enforceBan(player, status) then
			return { ok = false, reason = "banned" }
		end
		local code = data and data.error and data.error.code or "request_failed"
		return { ok = false, reason = code }
	end

	if not deliverItem(player, itemId) then
		return { ok = false, reason = "delivery_failed" }
	end

	return { ok = true, pointsRemaining = data.pointsRemaining }
end

Players.PlayerRemoving:Connect(function(player)
	lastRedeemAt[player] = nil
end)
