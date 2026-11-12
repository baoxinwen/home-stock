import { currentRunDataDir, prepareWorkspace } from './helpers/env';

export default function globalSetup(): void {
  prepareWorkspace(currentRunDataDir());
}
