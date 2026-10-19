import "./styles.css";
import { sampleStudyPlans } from "./sampleData";
import { CloudSync } from "./sync/cloudSync";
import { chooseSourceDialog, openNewPasswordDialog } from "./sync/syncUi";
import { Timetable } from "./timetable";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
    throw new Error("#app container was not found.");
}

// How long the first render waits for the account's data, so a phone opens on fresh data without a reload.
const FIRST_SYNC_WAIT_MS = 2500;

const mount = (sync: CloudSync | null): void => {
    const timetable = new Timetable(sampleStudyPlans);
    if (sync) {
        timetable.setCloudSync(sync);
    }
    timetable.attach(app);
};

if (CloudSync.isConfigured()) {
    const sync = new CloudSync(chooseSourceDialog);
    let mounted = false;
    // Data from another device replaced what is loaded: reload so every part of the app picks it up.
    sync.onRemoteApplied = () => {
        if (mounted) {
            window.location.reload();
        }
    };
    sync.onPasswordRecovery = () => openNewPasswordDialog(sync);
    const firstSync = sync.start();
    const wait = new Promise((resolve) => window.setTimeout(resolve, FIRST_SYNC_WAIT_MS));
    void Promise.race([firstSync, wait]).then(() => {
        mounted = true;
        mount(sync);
    });
} else {
    mount(null);
}
