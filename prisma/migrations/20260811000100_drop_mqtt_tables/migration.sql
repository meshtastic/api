-- Drop the MQTT-derived tables.
--
-- The MQTT ingest, the GET /mqtt endpoint and the gatewayStream RPC have all
-- been removed, so nothing writes or reads these tables. They were the only two
-- models in the schema.
--
-- This is irreversible. It destroys the stored coordinates for good -- which is
-- the point, see the preceding migration -- and takes the per-channel message
-- counters with them.
--
-- Channel is dropped first: it carries the foreign key to Gateway.
DROP TABLE IF EXISTS "Channel";
DROP TABLE IF EXISTS "Gateway";
