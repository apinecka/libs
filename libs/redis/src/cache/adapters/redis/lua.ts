import Redis, { Result } from 'ioredis'

// Add declarations
declare module 'ioredis' {
	interface RedisCommander<Context> {
		cache(
			keyCount: 1,
			key: string,
			command: 'getData',
		): Result<null | string, Context>
		cache(
			keyCount: 4,
			key: string,
			// JSON stringified data
			data: string,
			// Expiration in seconds
			expiration: number,
			// Tags separated with comma
			tags: string,
			command: 'setData',
		): Result<null, Context>
		cache(
			keyCount: 1,
			tag: string,
			command: 'invalidate',
		): Result<null, Context>
		cache(
			keyCount: 1,
			// Tags separated with comma
			tags: string,
			command: 'invalidateTags',
		): Result<null, Context>
		cache(
			keyCount: 0,
			command: 'flush',
		): Result<null, Context>
	}
}

export const commandsAliases = (redis: Redis) => ({
	getData: (key: string) => redis.cache(1, key, 'getData'),
	setData: (key: string, data: string, expiration: number, tags: string) => redis.cache(4, key, data, expiration, tags, 'setData'),
	invalidate: (tag: string) => redis.cache(1, tag, 'invalidate'),
	invalidateTags: (tags: string) => redis.cache(1, tags, 'invalidateTags'),
	flush: () => redis.cache(0, 'flush'),
})

export const cacheCommand = ({ namespace = 'data', scanBulk = 1000 }: {
	namespace: string
	scanBulk: number
}) => ({
	lua: `
		-- KEYS  - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

		-- Get scannable item-tag record key
		local function getTagKey(tag, key)
			return "${namespace}" .. ":tag:" .. tag .. ":" .. key
		end

		-- Get item data key
		local function getItemDataKey(key)
			return "${namespace}" .. ":item-data:" .. key
		end

		-- Get item tags set key
		local function getItemTagsKey(key)
			return "${namespace}" .. ":item-tags:" .. key
		end

		-- HELPERS  - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

		-- Remove scannable records - tags
		local function removeKeyTags(key, tags)
			local existingTags = redis.call('sMembers', getItemTagsKey(key))

			if (existingTags == nil or table.getn(existingTags) < 1) then
				return
			end

			redis.call('del', getItemTagsKey(key))

			for index = 1, table.getn(existingTags) do
				redis.call('del', getTagKey(existingTags[index], key))
			end
		end

		-- Create scannable records - tags
		local function createKeyTags(key, tags, expiration)
			if (tags == nil or table.getn(tags) < 1) then
				return
			end

			local itemTagsKey = getItemTagsKey(key)

			redis.call('sAdd', itemTagsKey, unpack(tags))
			redis.call('expire', itemTagsKey, expiration)

			for index = 1, table.getn(tags) do
				redis.call('set', getTagKey(tags[index], key), '', 'EX', expiration)
			end
		end

		-- REGISTERED FUNCTIONS  - - - - - - - - - - - - - - - - - - - - - - - - - 

		-- Get item data
		local function getData(key)
			return redis.call('get', getItemDataKey(key))
		end

		-- Set item data
		local function setData(key, data, expiration, tags)
			removeKeyTags(key)

			redis.call('set', getItemDataKey(key), data, 'EX', expiration)

			createKeyTags(key, tags, expiration)
		end

		-- Remove item data and tags
		local function invalidate(key)
			local res = redis.call('del', getItemDataKey(key))
			local count = tonumber(res)

			if (count > 0) then
				removeKeyTags(key)
			end

			return count
		end

		-- Remove item data and tags by selected tag
		local function invalidateTag(tag)

			local cursor = "0"
			local count = 0

			repeat
				local scanRes = redis.call('scan', cursor, 'MATCH', getTagKey(tag, '*'), 'COUNT', ${scanBulk})

				local keys
				cursor, keys = unpack(scanRes)

				if next(keys) then
					for _, tagKey in pairs(keys) do
						
						local itemKey = tagKey:match("[%w-_]+:[%w-_]+:[%w-_]+:([%w-_]+)")

						local res = redis.call('del', getItemDataKey(itemKey))
						count = count + tonumber(res)

						redis.call('del', getItemTagsKey(itemKey), tagKey)

					end
				end

			until( cursor == "0" )

			return count

		end

		-- Remove items data and tags by selected tags
		local function invalidateTags(tags)
			
			local count = 0

			for index = 1, table.getn(tags) do
				count = count + invalidateTag(tags[index])
			end

			return count
			
		end

		-- Flush the whole cache namespace
		local function flush()
			
			local cursor = "0"

			repeat
				local scanRes = redis.call('scan', cursor, 'MATCH', '${namespace}' .. ':*', 'COUNT', ${scanBulk})

				local keys
				cursor, keys = unpack(scanRes)

				if next(keys) then
					for _, key in pairs(keys) do
						
						redis.call('del', key)

					end
				end

			until( cursor == "0" )
			
		end

		-- MAIN (switch) - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

		if (ARGV[1] == "getData") then

			return getData(KEYS[1])

		elseif (ARGV[1] == "setData") then

			local key = KEYS[1]
			local data = KEYS[2]
			local expiration = KEYS[3]
			local tags = {}
			for tag in KEYS[4]:gmatch('([^,]+)') do
				tags[#tags+1] = tag
			end

			return setData(key, data, expiration, tags)

		elseif (ARGV[1] == "invalidate") then

			return invalidate(KEYS[1])

		elseif (ARGV[1] == "invalidateTags") then

			local tags = {}
			for tag in KEYS[1]:gmatch('([^,]+)') do
				tags[#tags+1] = tag
			end

			return invalidateTags(tags)

		elseif (ARGV[1] == "flush") then

			return flush()

		else 
			return ARGV[1]
		end
	`
})
