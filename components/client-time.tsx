'use client';

import React, { useState, useEffect } from 'react';

export function ClientTime({ 
  date, 
  showTime = true, 
  showDate = false 
}: { 
  date: string | Date | undefined; 
  showTime?: boolean; 
  showDate?: boolean;
}) {
  const [formatted, setFormatted] = useState<string>('');

  useEffect(() => {
    if (!date) return;
    const d = new Date(date);
    if (isNaN(d.getTime())) return;
    
    if (showTime && showDate) {
      setFormatted(d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
    } else if (showTime) {
      setFormatted(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } else {
      setFormatted(d.toLocaleDateString());
    }
  }, [date, showTime, showDate]);

  return <>{formatted}</>;
}
