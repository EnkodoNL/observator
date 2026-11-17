// SPDX-License-Identifier: FSL-1.1-ALv2

/**
 * Products checked against endoflife.date: release lines with their end of life and newest
 * patch. The key is endoflife.date's id and doubles as the runtime name. Client-safe, for labels.
 */
export const EOL_PRODUCTS: Readonly<Record<string, string>> = {
  mariadb: "MariaDB",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  redis: "Redis",
  valkey: "Valkey",
  clickhouse: "ClickHouse",
  rabbitmq: "RabbitMQ",
  meilisearch: "Meilisearch",
  nginx: "nginx",
  traefik: "Traefik",
  grafana: "Grafana",
};
