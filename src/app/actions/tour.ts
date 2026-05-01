'use server';

import { getSupabaseWithUser } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';

export async function markTourComplete() {
  const { supabase, user } = await getSupabaseWithUser();

  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ tour_completed_v1: true })
    .eq('id', user.id);

  if (error) {
    console.error('[tour] Failed to mark complete:', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/');
  return { success: true };
}

export async function resetTour() {
  const { supabase, user } = await getSupabaseWithUser();

  if (!user) return { success: false };

  const { error } = await supabase
    .from('user_profiles')
    .update({ tour_completed_v1: false })
    .eq('id', user.id);

  return { success: !error };
}
