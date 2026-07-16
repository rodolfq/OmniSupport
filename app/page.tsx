'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.push('/dashboard');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[var(--surface-card)]">
      <div className="w-12 h-12 border-4 border-indigo-600 dark:border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
