import { seed, type State } from "@kynetis/shared/domain";
// Only display fields come from user metadata. Memberships and roles always come from the database.
export function initialCustomerState(user: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}): State {
  const state = seed(),
    metadata = user.user_metadata ?? {};

  state.profile = {
    ...state.profile,
    firstName:
      typeof metadata.first_name === "string"
        ? metadata.first_name.slice(0, 150)
        : "",
    lastName:
      typeof metadata.last_name === "string"
        ? metadata.last_name.slice(0, 150)
        : "",
    email: user.email ?? "",
    nationality:
      typeof metadata.nationality === "string" ? metadata.nationality : "",
    phone: "",
    dob:
      typeof metadata.date_of_birth === "string" ? metadata.date_of_birth : "",
    additionalNationalities: Array.isArray(metadata.additional_nationalities)
      ? metadata.additional_nationalities.filter(
          (n): n is string => typeof n === "string",
        )
      : [],
    kyc: "TB-" + user.id.replaceAll("-", "").toUpperCase(),
  };
  state.consents = [];
  state.institutions = [];
  return state;
}
