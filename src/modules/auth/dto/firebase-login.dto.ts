import type { Registration } from "@kynetis/shared/registration";
// Incoming values remain unknown until the service's runtime checks accept them.
export interface FirebaseLoginDto {
  idToken: unknown;
  existingPassword?: unknown;
  profile?: Pick<
    Registration,
    "firstName" | "lastName" | "nationality" | "additionalNationalities"
  >;
}
