WITH candidate_rows AS (
  SELECT
    igdb_game_id,
    platform_igdb_id,
    payload,
    updated_at,
    CASE
      WHEN BTRIM(COALESCE(payload->>'hltbMainHours', '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (BTRIM(payload->>'hltbMainHours'))::numeric > 0
      ELSE false
    END AS has_hltb_main,
    CASE
      WHEN BTRIM(COALESCE(payload->>'hltbMainExtraHours', '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (BTRIM(payload->>'hltbMainExtraHours'))::numeric > 0
      ELSE false
    END AS has_hltb_main_extra,
    CASE
      WHEN BTRIM(COALESCE(payload->>'hltbCompletionistHours', '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (BTRIM(payload->>'hltbCompletionistHours'))::numeric > 0
      ELSE false
    END AS has_hltb_completionist,
    CASE
      WHEN BTRIM(COALESCE(payload->>'reviewScore', '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (BTRIM(payload->>'reviewScore'))::numeric > 0
      ELSE false
    END AS has_review_score,
    CASE
      WHEN BTRIM(COALESCE(payload->>'metacriticScore', '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (BTRIM(payload->>'metacriticScore'))::numeric > 0
      ELSE false
    END AS has_metacritic_score,
    CASE
      WHEN BTRIM(COALESCE(payload->>'releaseYear', '')) ~ '^[0-9]{4}$'
      THEN (BTRIM(payload->>'releaseYear'))::int
      ELSE NULL
    END AS release_year,
    CASE
      WHEN BTRIM(COALESCE(payload->'enrichmentRetry'->'hltb'->>'nextTryAt', '')) ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      THEN (BTRIM(payload->'enrichmentRetry'->'hltb'->>'nextTryAt'))::timestamptz
      ELSE NULL
    END AS hltb_next_try_at_ts,
    CASE
      WHEN BTRIM(COALESCE(payload->'enrichmentRetry'->'hltb'->>'lastTriedAt', '')) ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      THEN (BTRIM(payload->'enrichmentRetry'->'hltb'->>'lastTriedAt'))::timestamptz
      ELSE NULL
    END AS hltb_last_tried_at_ts,
    CASE
      WHEN BTRIM(COALESCE(payload->'enrichmentRetry'->'metacritic'->>'nextTryAt', '')) ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      THEN (BTRIM(payload->'enrichmentRetry'->'metacritic'->>'nextTryAt'))::timestamptz
      ELSE NULL
    END AS metacritic_next_try_at_ts,
    CASE
      WHEN BTRIM(COALESCE(payload->'enrichmentRetry'->'metacritic'->>'lastTriedAt', '')) ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      THEN (BTRIM(payload->'enrichmentRetry'->'metacritic'->>'lastTriedAt'))::timestamptz
      ELSE NULL
    END AS metacritic_last_tried_at_ts,
    CASE
      WHEN BTRIM(COALESCE(payload->'enrichmentRetry'->'hltb'->>'attempts', '')) ~ '^[0-9]+$'
      THEN (BTRIM(payload->'enrichmentRetry'->'hltb'->>'attempts'))::int
      ELSE 0
    END AS hltb_attempts,
    CASE
      WHEN BTRIM(COALESCE(payload->'enrichmentRetry'->'metacritic'->>'attempts', '')) ~ '^[0-9]+$'
      THEN (BTRIM(payload->'enrichmentRetry'->'metacritic'->>'attempts'))::int
      ELSE 0
    END AS metacritic_attempts,
    COALESCE(
      payload->'enrichmentRetry'->'hltb'->>'permanentMiss' = 'true',
      false
    ) AS hltb_permanent_miss,
    COALESCE(
      payload->'enrichmentRetry'->'metacritic'->>'permanentMiss' = 'true',
      false
    ) AS metacritic_permanent_miss
  FROM games
  WHERE COALESCE(payload->>'listType', '') = 'discovery'
)
SELECT igdb_game_id, platform_igdb_id, payload
FROM candidate_rows
WHERE (
    NOT (has_hltb_main OR has_hltb_main_extra OR has_hltb_completionist)
    AND (
      (
        NOT hltb_permanent_miss
        AND hltb_attempts < $2
        AND (hltb_next_try_at_ts IS NULL OR hltb_next_try_at_ts <= $3::timestamptz)
      )
      OR (
        (hltb_permanent_miss OR hltb_attempts >= $2)
        AND (release_year IS NULL OR release_year >= $5)
        AND (
          hltb_last_tried_at_ts IS NULL
          OR hltb_last_tried_at_ts <= ($3::timestamptz - make_interval(days => $4))
        )
      )
    )
  )
  OR (
    NOT (has_review_score OR has_metacritic_score)
    AND (
      (
        NOT metacritic_permanent_miss
        AND metacritic_attempts < $2
        AND (
          metacritic_next_try_at_ts IS NULL
          OR metacritic_next_try_at_ts <= $3::timestamptz
        )
      )
      OR (
        (metacritic_permanent_miss OR metacritic_attempts >= $2)
        AND (release_year IS NULL OR release_year >= $5)
        AND (
          metacritic_last_tried_at_ts IS NULL
          OR metacritic_last_tried_at_ts <= ($3::timestamptz - make_interval(days => $4))
        )
      )
    )
  )
ORDER BY updated_at ASC
LIMIT $1
