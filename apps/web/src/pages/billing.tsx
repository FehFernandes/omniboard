import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth/auth-context';
import { Button, Badge } from '../components/ui';
import { errorMessage } from '../lib/telemetry/errors';

interface Plan {
  key: string;
  name: string;
  amount: number;
  currency: string;
  interval: string;
  free: boolean;
}

interface Subscription {
  plan: string;
  status: string;
  provider: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

interface PlansResponse {
  success: true;
  plans: Plan[];
  provider: string;
}

interface SubscriptionResponse {
  success: true;
  subscription: Subscription;
}

interface CheckoutResponse {
  success: true;
  checkout_url: string;
}

interface PortalResponse {
  success: true;
  portal_url: string;
}

export function BillingPage() {
  const { client } = useAuth();
  const [searchParams] = useSearchParams();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [provider, setProvider] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  const justPaid = searchParams.get('paid') === '1';

  useEffect(() => {
    async function load() {
      try {
        const [plansRes, subRes] = await Promise.all([
          client.get<PlansResponse>('/billing/plans'),
          client.get<SubscriptionResponse>('/billing/subscription'),
        ]);
        setPlans(plansRes.plans);
        setProvider(plansRes.provider);
        setSub(subRes.subscription);
      } catch (e: unknown) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [client]);

  const handleCheckout = async (planKey: string) => {
    setCheckoutLoading(planKey);
    setError('');
    try {
      const res = await client.post<CheckoutResponse>('/billing/checkout', { plan: planKey });
      window.location.href = res.checkout_url;
    } catch (e: unknown) {
      setError(errorMessage(e));
      setCheckoutLoading(null);
    }
  };

  const handlePortal = async () => {
    setError('');
    try {
      const res = await client.post<PortalResponse>('/billing/portal');
      window.location.href = res.portal_url;
    } catch (e: unknown) {
      setError(errorMessage(e));
    }
  };

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;

  const isActive = sub?.status === 'active' || sub?.status === 'trialing';
  const currentPlan = sub?.plan ?? 'free';

  return (
    <div className="mx-auto mt-10 w-full max-w-2xl p-4">
      <h1 className="mb-6 text-xl font-semibold">Billing</h1>

      {justPaid && (
        <div className="mb-4 rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          ✓ Payment confirmed! Your subscription is active.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Current subscription */}
      <div className="mb-6 rounded border border-gray-200 p-4">
        <h2 className="mb-2 font-medium">Current plan</h2>
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold capitalize">{currentPlan}</span>
          {isActive && <Badge tone="green">Active</Badge>}
          {sub?.status === 'canceled' && <Badge tone="amber">Canceled</Badge>}
          {!isActive && sub?.status !== 'canceled' && <Badge tone="gray">Inactive</Badge>}
        </div>
        {sub?.current_period_end && (
          <p className="mt-1 text-sm text-gray-500">
            {sub.cancel_at_period_end ? 'Access until' : 'Renews on'}:{' '}
            {new Date(sub.current_period_end).toLocaleDateString()}
          </p>
        )}
        {isActive && sub?.plan !== 'free' && (
          <button
            onClick={() => void handlePortal()}
            className="mt-2 text-sm text-gray-600 underline hover:text-gray-900"
          >
            Manage subscription (change card, cancel)
          </button>
        )}
        <p className="mt-2 text-xs text-gray-400">Provedor: {provider}</p>
      </div>

      {/* Plans grid */}
      <h2 className="mb-3 font-medium">Available plans</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {plans.map((plan) => {
          const isCurrent = plan.key === currentPlan;
          return (
            <div
              key={plan.key}
              className={`rounded border p-4 ${isCurrent ? 'border-gray-900 bg-gray-50' : 'border-gray-200'}`}
            >
              <h3 className="font-semibold">{plan.name}</h3>
              <p className="mt-1 text-2xl font-bold">
                {plan.free
                  ? 'Free'
                  : `R$ ${(plan.amount / 100).toFixed(2).replace('.', ',')}`}
                {!plan.free && (
                  <span className="text-sm font-normal text-gray-500">/{plan.interval === 'month' ? 'month' : 'year'}</span>
                )}
              </p>
              <div className="mt-3">
                {isCurrent ? (
                  <span className="text-sm font-medium text-gray-500">Current plan</span>
                ) : plan.free ? (
                  <span className="text-xs text-gray-400">Default plan</span>
                ) : (
                  <Button
                    onClick={() => void handleCheckout(plan.key)}
                    disabled={checkoutLoading !== null}
                  >
                    {checkoutLoading === plan.key ? 'Redirecting…' : 'Subscribe'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
