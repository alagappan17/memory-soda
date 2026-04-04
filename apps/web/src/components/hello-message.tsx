'use client';

import { useHello } from '@/hooks/use-hello';

export default function HelloMessage() {
  const { data, isPending, isError } = useHello();

  if (isPending) return <p>Loading...</p>;
  if (isError) return <p>Failed to load message.</p>;

  return <p>{data.message}</p>;
}
