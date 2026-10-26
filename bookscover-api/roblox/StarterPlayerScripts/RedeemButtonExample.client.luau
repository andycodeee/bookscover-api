-- LocalScript: place in StarterPlayerScripts. The client sends ONLY an item id.
-- The server validates the request and decides cost, balance, and ownership.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local redeemRemote = ReplicatedStorage:WaitForChild("RedeemItem")

local EXAMPLE_ITEM_ID = 123456789 -- a catalog asset id from your /v1/admin/items list

local function redeem(itemId: number)
	local result = redeemRemote:InvokeServer(itemId)
	if result.ok then
		print("Redeemed. Points left:", result.pointsRemaining)
	else
		warn("Redeem failed:", result.reason)
	end
end

-- Hook this to a real UI button in your game, for example:
-- button.Activated:Connect(function() redeem(EXAMPLE_ITEM_ID) end)
redeem(EXAMPLE_ITEM_ID)
