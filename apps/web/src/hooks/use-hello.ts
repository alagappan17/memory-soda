import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { HelloWorldResponse } from '@memory-soda/types';

export const useHello = () => {
  return useQuery<HelloWorldResponse>({
    queryKey: ['hello'],
    queryFn: () => api.get('/hello').then((res) => res.data),
  });
};
