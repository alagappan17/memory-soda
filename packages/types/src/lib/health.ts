export type ServiceStatus = 'ok' | 'error';

export interface HealthResponse {
  status: ServiceStatus;
  services: {
    postgres: ServiceStatus;
    redis: ServiceStatus;
    neo4j: ServiceStatus;
  };
}
