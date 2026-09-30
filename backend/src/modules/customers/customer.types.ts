/** A customer as exposed by the API. Never carries credentials. */
export interface Customer {
  id: string;
  email: string;
  fullName: string;
}

/** A customer including the stored password hash. Must not leave the backend. */
export interface CustomerWithPasswordHash extends Customer {
  passwordHash: string;
}
