export type ServiceStatus = 'ok' | 'error';

export interface HealthResponse {
  status: ServiceStatus;
  services: {
    postgres: ServiceStatus;
  };
}
