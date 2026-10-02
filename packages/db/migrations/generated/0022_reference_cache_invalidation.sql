-- Activating or rolling back a reference version clears cached public responses for that source.
-- The cache holds public provider data only, so the importer may read and delete it.
GRANT SELECT, DELETE ON provider_response_cache TO surveynt_reference_write;
