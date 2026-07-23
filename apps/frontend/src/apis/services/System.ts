import request from "apis";
import { SettingsView } from "../model/system";

class SystemService {
  /** Aggregate view for the System Settings page. */
  static getSettingsView(): Promise<SettingsView> {
    return request.get("/settings-view");
  }
}

export default SystemService;
