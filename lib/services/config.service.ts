import { supabase } from '../supabase';

export async function fetchPriorities(signal?: AbortSignal): Promise<any[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('config_priorities')
        .select('*')
        .abortSignal(signal as any);
    if (error) {
        const isAbortError = error.message === 'FetchIsAborted' || error.code === '20' || error.message?.toLowerCase().includes('aborted') || error.message?.toLowerCase().includes('lock broken') || error.message?.toLowerCase().includes('request was aborted');
        if (isAbortError) return [];
        console.error("Error fetching priorities:", error);
        return [];
    }
    return data || [];
}

export async function fetchQuickNotes(signal?: AbortSignal): Promise<any[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('quick_notes').select('*').abortSignal(signal as any);
    if (error) { 
        const isAbortError = error.message === 'FetchIsAborted' || error.code === '20' || error.message?.toLowerCase().includes('aborted') || error.message?.toLowerCase().includes('lock broken') || error.message?.toLowerCase().includes('request was aborted');
        if (isAbortError) return [];
        console.error("Error fetching quick notes:", error); return []; 
    }
    return data || [];
}

export async function fetchAnalystStatuses(signal?: AbortSignal): Promise<any[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('analyst_status').select('*').abortSignal(signal as any);
    if (error) { 
        const isAbortError = error.message === 'FetchIsAborted' || error.code === '20' || error.message?.toLowerCase().includes('aborted') || error.message?.toLowerCase().includes('lock broken') || error.message?.toLowerCase().includes('request was aborted');
        if (isAbortError) return [];
        console.error("Error fetching analyst statuses:", error); return []; 
    }
    return data || [];
}

export async function fetchCompanies(signal?: AbortSignal): Promise<any[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('companies').select('*').abortSignal(signal as any);
    if (error) { 
        const isAbortError = error.message === 'FetchIsAborted' || error.code === '20' || error.message?.toLowerCase().includes('aborted') || error.message?.toLowerCase().includes('lock broken') || error.message?.toLowerCase().includes('request was aborted');
        if (isAbortError) return [];
        console.error("Error fetching companies:", error); return []; 
    }
    return data || [];
}

export async function fetchUsers(signal?: AbortSignal): Promise<any[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('profiles').select('*').abortSignal(signal as any);
    if (error) { 
        const isAbortError = error.message === 'FetchIsAborted' || error.code === '20' || error.message?.toLowerCase().includes('aborted') || error.message?.toLowerCase().includes('lock broken') || error.message?.toLowerCase().includes('request was aborted');
        if (isAbortError) return [];
        console.error("Error fetching users:", error); return []; 
    }
    return data || [];
}

export async function fetchQueues(signal?: AbortSignal): Promise<any[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('queues').select('*').abortSignal(signal as any);
    if (error) { 
        const isAbortError = error.message === 'FetchIsAborted' || error.code === '20' || error.message?.toLowerCase().includes('aborted') || error.message?.toLowerCase().includes('lock broken') || error.message?.toLowerCase().includes('request was aborted');
        if (isAbortError) return [];
        console.error("Error fetching queues:", error); return []; 
    }
    return data || [];
}

export async function fetchStatuses(signal?: AbortSignal): Promise<any[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('config_statuses').select('*').abortSignal(signal as any);
    if (error) { 
        const isAbortError = error.message === 'FetchIsAborted' || error.code === '20' || error.message?.toLowerCase().includes('aborted') || error.message?.toLowerCase().includes('lock broken') || error.message?.toLowerCase().includes('request was aborted');
        if (isAbortError) return [];
        console.error("Error fetching statuses:", error); return []; 
    }
    return data || [];
}