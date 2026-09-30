import { ApiError, apiFetch } from "./api";

export interface Customer {
  id: string;
  email: string;
  fullName: string;
}

export async function login(email: string, password: string): Promise<Customer> {
  const { customer } = await apiFetch<{ customer: Customer }>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  return customer;
}

export function logout(): Promise<void> {
  return apiFetch<void>("/auth/logout", { method: "POST" });
}

/** The signed-in customer, or `null` when there is no valid session. */
export async function getCurrentCustomer(signal?: AbortSignal): Promise<Customer | null> {
  try {
    const { customer } = await apiFetch<{ customer: Customer }>("/auth/me", { signal });
    return customer;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}
