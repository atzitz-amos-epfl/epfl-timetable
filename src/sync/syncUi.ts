import type { CloudSync, SyncStatus } from "./cloudSync";

const FADE_MS = 180;

/** Same dialog frame as the rest of the app: header, body, footer. */
const openDialog = (title: string, subtitle: string, options: { dismissible?: boolean } = {}): {
  form: HTMLFormElement;
  body: HTMLElement;
  footer: HTMLElement;
  close: () => void;
} => {
  document.querySelector(".sync-modal-backdrop")?.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "course-link-modal-backdrop sync-modal-backdrop";
  const form = document.createElement("form");
  form.className = "course-edit-modal agenda-modal sync-modal";
  form.setAttribute("role", "dialog");
  form.setAttribute("aria-modal", "true");
  form.setAttribute("aria-label", title);
  form.noValidate = true;

  const header = document.createElement("header");
  header.className = "course-link-modal-header";
  const titleBlock = document.createElement("div");
  const heading = document.createElement("h3");
  heading.className = "course-link-modal-title";
  heading.textContent = title;
  titleBlock.appendChild(heading);
  if (subtitle) {
    const sub = document.createElement("p");
    sub.className = "course-edit-status";
    sub.textContent = subtitle;
    titleBlock.appendChild(sub);
  }
  header.appendChild(titleBlock);

  const body = document.createElement("div");
  body.className = "course-edit-body";
  const footer = document.createElement("footer");
  footer.className = "course-edit-footer";
  form.append(header, body, footer);
  backdrop.appendChild(form);
  document.body.appendChild(backdrop);

  const close = (): void => {
    backdrop.classList.remove("visible");
    window.removeEventListener("keydown", onKey);
    window.setTimeout(() => backdrop.remove(), FADE_MS);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && options.dismissible !== false) {
      close();
    }
  };
  if (options.dismissible !== false) {
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "course-link-modal-close";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", close);
    header.appendChild(closeButton);
  }
  window.addEventListener("keydown", onKey);
  window.requestAnimationFrame(() => backdrop.classList.add("visible"));
  return { form, body, footer, close };
};

const field = (label: string, input: HTMLInputElement): HTMLLabelElement => {
  const wrapper = document.createElement("label");
  wrapper.className = "agenda-field wide";
  const caption = document.createElement("span");
  caption.textContent = label;
  wrapper.append(caption, input);
  return wrapper;
};

const input = (type: string, autocomplete: string): HTMLInputElement => {
  const element = document.createElement("input");
  element.type = type;
  element.autocomplete = autocomplete as AutoFill;
  element.required = true;
  return element;
};

const button = (label: string, className: string, type: "button" | "submit" = "button"): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = type;
  element.className = className;
  element.textContent = label;
  return element;
};

const message = (className: string): HTMLParagraphElement => {
  const element = document.createElement("p");
  element.className = className;
  element.setAttribute("role", "status");
  return element;
};

const MIN_PASSWORD = 8;

/** Sign in, or create an account, with an email and a password. */
export const openAuthDialog = (sync: CloudSync, mode: "sign-in" | "sign-up" = "sign-in"): void => {
  const { form, body, footer, close } = openDialog(
    mode === "sign-in" ? "Sign in to sync" : "Create an account",
    "Your planner, course corrections and agenda follow you on every device.",
  );

  const email = input("email", "email");
  email.placeholder = "you@example.com";
  const password = input("password", mode === "sign-in" ? "current-password" : "new-password");
  const confirm = input("password", "new-password");
  const fields = document.createElement("div");
  fields.className = "agenda-form-grid";
  fields.append(field("Email", email), field("Password", password));
  if (mode === "sign-up") {
    password.minLength = MIN_PASSWORD;
    password.placeholder = `At least ${MIN_PASSWORD} characters`;
    fields.appendChild(field("Repeat the password", confirm));
  }
  const error = message("course-edit-error");
  const info = message("sync-info");

  const links = document.createElement("div");
  links.className = "sync-links";
  const switchMode = button(mode === "sign-in" ? "No account yet? Create one" : "Already have an account? Sign in", "agenda-link");
  switchMode.addEventListener("click", () => {
    close();
    window.setTimeout(() => openAuthDialog(sync, mode === "sign-in" ? "sign-up" : "sign-in"), FADE_MS);
  });
  links.appendChild(switchMode);
  if (mode === "sign-in") {
    const forgot = button("Forgot your password?", "agenda-link");
    forgot.addEventListener("click", async () => {
      error.textContent = "";
      info.textContent = "";
      if (!email.value.trim()) {
        error.textContent = "Type your email first.";
        email.focus();
        return;
      }
      const problem = await sync.sendPasswordReset(email.value.trim());
      if (problem) {
        error.textContent = problem;
      } else {
        info.textContent = "If this email has an account, a link to reset the password is on its way.";
      }
    });
    links.appendChild(forgot);
  }
  body.append(fields, error, info, links);

  const cancel = button("Cancel", "course-link-modal-close");
  cancel.addEventListener("click", close);
  const submit = button(mode === "sign-in" ? "Sign in" : "Create account", "course-edit-save", "submit");
  footer.append(cancel, submit);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    info.textContent = "";
    const address = email.value.trim();
    if (!address || !email.checkValidity()) {
      error.textContent = "Type a valid email.";
      email.focus();
      return;
    }
    if (!password.value) {
      error.textContent = "Type your password.";
      password.focus();
      return;
    }
    if (mode === "sign-up") {
      if (password.value.length < MIN_PASSWORD) {
        error.textContent = `Use at least ${MIN_PASSWORD} characters.`;
        password.focus();
        return;
      }
      if (password.value !== confirm.value) {
        error.textContent = "The two passwords don't match.";
        confirm.focus();
        return;
      }
    }
    submit.disabled = true;
    submit.textContent = mode === "sign-in" ? "Signing in…" : "Creating…";
    if (mode === "sign-in") {
      const problem = await sync.signIn(address, password.value);
      if (problem) {
        error.textContent = problem;
        submit.disabled = false;
        submit.textContent = "Sign in";
        return;
      }
      close();
      return;
    }
    const { error: problem, needsConfirmation } = await sync.signUp(address, password.value);
    submit.disabled = false;
    submit.textContent = "Create account";
    if (problem) {
      error.textContent = problem;
      return;
    }
    if (needsConfirmation) {
      info.textContent = `Almost there: open the link sent to ${address} to confirm it, then sign in here.`;
      submit.hidden = true;
      cancel.textContent = "Done";
      return;
    }
    close();
  });

  window.requestAnimationFrame(() => email.focus());
};

/** After opening a password reset link: choose the new password. */
export const openNewPasswordDialog = (sync: CloudSync): void => {
  const { form, body, footer, close } = openDialog("Choose a new password", "");
  const password = input("password", "new-password");
  password.placeholder = `At least ${MIN_PASSWORD} characters`;
  const confirm = input("password", "new-password");
  const fields = document.createElement("div");
  fields.className = "agenda-form-grid";
  fields.append(field("New password", password), field("Repeat it", confirm));
  const error = message("course-edit-error");
  body.append(fields, error);
  const cancel = button("Cancel", "course-link-modal-close");
  cancel.addEventListener("click", close);
  const submit = button("Save password", "course-edit-save", "submit");
  footer.append(cancel, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (password.value.length < MIN_PASSWORD) {
      error.textContent = `Use at least ${MIN_PASSWORD} characters.`;
      return;
    }
    if (password.value !== confirm.value) {
      error.textContent = "The two passwords don't match.";
      return;
    }
    submit.disabled = true;
    const problem = await sync.updatePassword(password.value);
    if (problem) {
      error.textContent = problem;
      submit.disabled = false;
      return;
    }
    close();
  });
  window.requestAnimationFrame(() => password.focus());
};

/** First sync on a device that already has its own data, different from the account's. */
export const chooseSourceDialog = (): Promise<"cloud" | "device"> => new Promise((resolve) => {
  const { form, body, footer, close } = openDialog(
    "Which data do you want to keep?",
    "This browser and your account both have a planner and agenda, and they differ.",
    { dismissible: false },
  );
  const text = document.createElement("p");
  text.className = "studies-note";
  text.textContent = "Keep the account's data to continue where you left off on your other devices (this browser's data is replaced), or keep this browser's data and send it to your account (the account's data is replaced).";
  body.appendChild(text);
  const device = button("Keep this browser's", "course-link-modal-close");
  device.addEventListener("click", () => {
    close();
    resolve("device");
  });
  const cloud = button("Keep the account's", "course-edit-save", "submit");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    close();
    resolve("cloud");
  });
  footer.append(device, cloud);
});

const timeAgo = (time: number): string => {
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 45) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  return new Date(time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};

const renderPanel = (panel: HTMLElement, sync: CloudSync, status: SyncStatus): void => {
  panel.replaceChildren();
  panel.hidden = status.state === "disabled";
  const title = document.createElement("h2");
  title.className = "sidebar-settings-title";
  title.textContent = "Sync";
  panel.appendChild(title);

  if (status.state === "signed-out") {
    const text = document.createElement("p");
    text.className = "sync-text";
    text.textContent = "Sign in to get your planner and agenda on your phone and your other devices.";
    const signIn = button("Sign in", "sync-button primary");
    signIn.addEventListener("click", () => openAuthDialog(sync));
    panel.append(text, signIn);
    return;
  }

  const account = document.createElement("p");
  account.className = "sync-account";
  account.innerHTML = '<i class="fa-solid fa-circle-user" aria-hidden="true"></i>';
  const address = document.createElement("span");
  address.textContent = status.email;
  address.title = status.email;
  account.appendChild(address);

  const line = document.createElement("p");
  line.className = `sync-status ${status.state}`;
  const icons: Record<string, string> = {
    syncing: "fa-arrows-rotate fa-spin",
    synced: "fa-circle-check",
    offline: "fa-cloud",
    error: "fa-triangle-exclamation",
  };
  line.innerHTML = `<i class="fa-solid ${icons[status.state] ?? "fa-cloud"}" aria-hidden="true"></i>`;
  const text = status.state === "syncing"
    ? "Syncing…"
    : status.state === "synced"
      ? `Synced ${status.lastSyncedAt ? timeAgo(status.lastSyncedAt) : ""}`.trim()
      : status.state === "offline" ? "Offline" : "Couldn't sync";
  line.append(` ${text}`);
  if (status.message) {
    line.title = status.message;
  }

  const actions = document.createElement("div");
  actions.className = "sync-actions";
  const now = button("Sync now", "sync-button");
  now.disabled = status.state === "syncing";
  now.addEventListener("click", () => void sync.sync());
  const out = button("Sign out", "sync-button");
  out.addEventListener("click", () => {
    if (window.confirm("Sign out? Your data stays in this browser; it just stops syncing.")) {
      void sync.signOut();
    }
  });
  actions.append(now, out);
  panel.append(account, line, actions);
  if (status.message && status.state !== "synced") {
    const detail = document.createElement("p");
    detail.className = "sync-text";
    detail.textContent = status.message;
    panel.appendChild(detail);
  }
};

/** Sidebar section showing the account and sync state; it updates itself as the state changes. */
export const createSyncPanel = (sync: CloudSync): HTMLElement => {
  const panel = document.createElement("section");
  panel.className = "sidebar-settings sync-panel";
  panel.setAttribute("aria-label", "Sync");
  renderPanel(panel, sync, sync.getStatus());
  const unsubscribe = sync.subscribe((status) => {
    // The app re-renders its sidebar often: panels no longer on the page stop listening.
    if (!panel.isConnected) {
      unsubscribe();
      return;
    }
    renderPanel(panel, sync, status);
  });
  return panel;
};
