import { z } from 'zod';

// Login goes through Google (redirect), not through a form — that is why there
// is no login, signup or password schema here. What is left is what the user
// still edits.

export const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  avatar: z.string().url('Invalid URL').optional().or(z.literal('')),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
