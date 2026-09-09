export interface BeaconBinding { id: string; path: string; started: boolean }
export interface BeaconTicket {
  id: string; number: string; title: string; type: string; status: string;
  question: string; answer: string; blockers: string[]; blocked: boolean;
  binding?: BeaconBinding; running?: boolean;
}
export interface BeaconMap {
  id: string; title: string; destination: string; fog: string; tickets: BeaconTicket[]; warnings: string[];
}
export interface BeaconSnapshot { cwd: string; maps: BeaconMap[]; origin?: BeaconBinding }
