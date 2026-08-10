import { useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { updateProfileSchema, type UpdateProfileInput } from '../lib/auth/schemas';
import { useAuth } from '../lib/auth/auth-context';
import { ApiError } from '../lib/api/client';
import { Badge, Button, TextField } from '../components/ui';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 font-medium">{title}</h2>
      {children}
    </section>
  );
}

export function AccountPage() {
  const { user, updateProfile, logoutAll } = useAuth();
  const [notice, setNotice] = useState('');

  const profile = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: user?.name ?? '', avatar: user?.avatar ?? '' },
  });

  const run = async (fn: () => Promise<void>, ok: string) => {
    setNotice('');
    try {
      await fn();
      setNotice(ok);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Error');
    }
  };

  return (
    <div className="mx-auto mt-10 w-full max-w-lg space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My account</h1>
        <Link to="/" className="text-sm text-gray-600 hover:underline">
          Back
        </Link>
      </div>
      {notice && <div className="rounded bg-gray-100 p-2 text-sm text-gray-700">{notice}</div>}

      <Section title="Profile">
        <form
          onSubmit={profile.handleSubmit((d) => run(() => updateProfile(d), 'Profile updated'))}
          className="space-y-3"
          noValidate
        >
          <TextField
            label="Name"
            {...profile.register('name')}
            error={profile.formState.errors.name?.message}
          />
          <TextField
            label="Avatar (URL)"
            {...profile.register('avatar')}
            error={profile.formState.errors.avatar?.message}
          />
          <Button type="submit" disabled={profile.formState.isSubmitting}>
            Save profile
          </Button>
        </form>
      </Section>

      {/* No password or email change: the identity is the Google account. */}
      <Section title="Login">
        <div className="rounded border border-gray-100 bg-gray-50 p-3">
          <p className="truncate text-sm text-gray-700">{user?.email}</p>
          <div className="mt-1">
            <Badge tone="green">Google account</Badge>
          </div>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          This account signs in through Google. To change the email or the sign-in
          password, change it in your Google account — the email is resynced on the
          next login.
        </p>
      </Section>

      <Section title="Sessions">
        <Button onClick={() => void logoutAll()}>Sign out everywhere</Button>
      </Section>
    </div>
  );
}
