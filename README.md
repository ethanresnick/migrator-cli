# migrator-cli

# TODO

- Work around the umzug architectural limitations that make it hard/impossible to transactionally execute + log (or unlog) a migration, even when the logs and the migrations are applied to the same db.
  - Accept tradeoff that this will force each user migration to be one trx; give control over isolation level.
