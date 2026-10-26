-- Script: place in ServerScriptService beside Data/datamanager and BookscoverAPI.
-- Mirrors the game's ProfileStore values to the Bookscover API. Roblox remains the
-- source of truth for game points; API failures never block gameplay or profile saves.

local Players = game:GetService("Players")
local ServerScriptService = game:GetService("ServerScriptService")

local DataManager = require(ServerScriptService.Data.datamanager)
local BookscoverAPI = require(ServerScriptService.BookscoverAPI)

local SYNC_INTERVAL_SECONDS = 45
local PROFILE_WAIT_SECONDS = 30

local function makeSnapshot(player)
	local profile = DataManager.profiles[player]
	if not profile then
		return nil
	end

	local data = profile.Data
	local boosts = {}
	for key, boost in pairs(data.Boosts or {}) do
		local multiplier = tonumber(key)
		local expiresAt = boost and tonumber(boost.ExpiresAt)
		if multiplier and expiresAt then
			table.insert(boosts, {
				multiplier = multiplier,
				expiresAt = expiresAt,
			})
		end
	end

	local multiplierValue = player:FindFirstChild("PointsMultiplier")
	return {
		username = player.Name,
		points = math.max(0, math.floor((tonumber(data.Points) or 0) * 1000 + 0.5) / 1000),
		stage = math.max(1, math.floor(tonumber(data.Stage) or 1)),
		groupRewardClaimed = data.ClaimedGroupReward == true,
		pointsMultiplier = math.clamp(tonumber(multiplierValue and multiplierValue.Value) or 1, 1, 1000),
		boosts = boosts,
	}
end

local function syncPlayer(player)
	local snapshot = makeSnapshot(player)
	if not snapshot then
		return false
	end

	local ok, status, response = BookscoverAPI.syncGameState(player.UserId, snapshot)
	if not ok then
		if status == 403 and player.Parent then
			player:Kick("This account is restricted.")
		else
			warn(string.format("[BookscoverAPI] state sync failed for %s (%s)", player.UserId, tostring(status)))
		end
		return false
	end
	return response
end

local function runPlayerSync(player)
	local waited = 0
	while player.Parent and not DataManager.profiles[player] and waited < PROFILE_WAIT_SECONDS do
		task.wait(0.25)
		waited += 0.25
	end
	if not player.Parent or not DataManager.profiles[player] then
		warn(string.format("[BookscoverAPI] profile not ready for %s; sync skipped", player.UserId))
		return
	end

	while player.Parent do
		syncPlayer(player)
		task.wait(SYNC_INTERVAL_SECONDS)
	end
end

Players.PlayerAdded:Connect(function(player)
	task.spawn(runPlayerSync, player)
end)
for _, player in Players:GetPlayers() do
	task.spawn(runPlayerSync, player)
end
