import { Link } from 'react-router-dom';

export function BillingSuccessPage() {
  return (
    <div className="mx-auto mt-20 max-w-md text-center">
      <div className="mb-4 text-4xl">✓</div>
      <h1 className="mb-2 text-xl font-semibold text-green-700">Payment confirmed!</h1>
      <p className="mb-6 text-gray-600">
        Your subscription is active. The plan features are available now.
      </p>
      <Link
        to="/billing?paid=1"
        className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
      >
        See my plan
      </Link>
    </div>
  );
}

export function BillingCancelPage() {
  return (
    <div className="mx-auto mt-20 max-w-md text-center">
      <div className="mb-4 text-4xl">✗</div>
      <h1 className="mb-2 text-xl font-semibold text-gray-700">Checkout cancelled</h1>
      <p className="mb-6 text-gray-600">
        No charge was made. You can try again whenever you want.
      </p>
      <Link
        to="/billing"
        className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
      >
        Voltar para planos
      </Link>
    </div>
  );
}
