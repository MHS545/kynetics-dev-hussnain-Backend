import { Injectable } from "@nestjs/common";
import { access, load, json, fail } from "../../workspace/workspace.js";

@Injectable()
export class CompletionService {
  async execute(request: Request) {
    try {
      const context = await access(request),
        { state } = await load(context.workspace);
      return json({ kycId: state.profile.kyc, name: state.profile.firstName });
    } catch (error) {
      return fail(error);
    }
  }
}
