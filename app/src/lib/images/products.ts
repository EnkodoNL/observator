// SPDX-License-Identifier: FSL-1.1-ALv2

/*
 * What an image is, by its repository as people write it ("mariadb", "bitnami/postgresql",
 * "ghcr.io/acme/app"). Public product and image names only; nothing here is about one setup.
 */

/** Images of a product endoflife.date knows, and the env key that carries its exact version. */
export const IMAGE_PRODUCTS: Readonly<Record<string, { product: string; env: string[] }>> = {
  mariadb: { product: "mariadb", env: ["MARIADB_VERSION"] },
  "bitnami/mariadb": { product: "mariadb", env: ["APP_VERSION"] },
  postgres: { product: "postgresql", env: ["PG_VERSION"] },
  "bitnami/postgresql": { product: "postgresql", env: ["APP_VERSION"] },
  "postgis/postgis": { product: "postgresql", env: ["PG_VERSION"] },
  mysql: { product: "mysql", env: ["MYSQL_VERSION"] },
  "bitnami/mysql": { product: "mysql", env: ["APP_VERSION"] },
  mongo: { product: "mongodb", env: ["MONGO_VERSION"] },
  "bitnami/mongodb": { product: "mongodb", env: ["APP_VERSION"] },
  redis: { product: "redis", env: ["REDIS_VERSION"] },
  "bitnami/redis": { product: "redis", env: ["APP_VERSION"] },
  "valkey/valkey": { product: "valkey", env: ["VALKEY_VERSION"] },
  "bitnami/valkey": { product: "valkey", env: ["APP_VERSION"] },
  "clickhouse/clickhouse-server": { product: "clickhouse", env: [] },
  rabbitmq: { product: "rabbitmq", env: ["RABBITMQ_VERSION"] },
  "bitnami/rabbitmq": { product: "rabbitmq", env: ["APP_VERSION"] },
  "getmeili/meilisearch": { product: "meilisearch", env: [] },
  nginx: { product: "nginx", env: ["NGINX_VERSION"] },
  "nginxinc/nginx-unprivileged": { product: "nginx", env: ["NGINX_VERSION"] },
  traefik: { product: "traefik", env: [] },
  "grafana/grafana": { product: "grafana", env: [] },
  "grafana/grafana-oss": { product: "grafana", env: [] },
};

/** Runtimes an image carries, by the env key its base image sets ("NODE_VERSION=18.20.3"). */
export const EMBEDDED_RUNTIMES: Readonly<Record<string, string>> = {
  NODE_VERSION: "node",
  PYTHON_VERSION: "python",
  PHP_VERSION: "php",
  RUBY_VERSION: "ruby",
};

/**
 * The GitHub repository of images that do not name it in their labels. GHCR images need no
 * entry: their path is the repository.
 */
export const IMAGE_SOURCES: Readonly<Record<string, string>> = {
  "louislam/uptime-kuma": "louislam/uptime-kuma",
  "docker.dragonflydb.io/dragonflydb/dragonfly": "dragonflydb/dragonfly",
  "dragonflydb/dragonfly": "dragonflydb/dragonfly",
};
