import { onToolOutput } from "./bridge.js";
import { errorMessage, isRecord, payload } from "./data.js";
import { element, empty, mount } from "./render.js";

function statCard(label: string, value: string): HTMLElement {
  const card = element("div", "ms-stat");
  card.append(element("span", "ms-stat-label", label));
  card.append(element("span", "ms-stat-value", value));
  return card;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const render = mount((output) => {
  const container = element("div", "ms-widget");
  container.append(element("h2", "ms-title", "MrScraper account"));

  const failure = errorMessage(output);
  if (failure) {
    container.append(element("p", "ms-error", failure));
    return container;
  }

  const data = payload(output);
  const account =
    isRecord(data) && isRecord(data.account) ? data.account : null;
  if (!account) {
    container.append(empty("No account details were returned."));
    return container;
  }

  const used = number(account.token_usage);
  const limit = number(account.token_limit);
  const percent = number(account.usage_percent);

  const stats = element("div", "ms-stats");
  stats.append(
    statCard(
      "Plan",
      account.enterprise
        ? "Enterprise"
        : String(account.subscription_status ?? "unknown"),
    ),
  );
  stats.append(
    statCard(
      "Tokens used",
      limit > 0
        ? `${used.toLocaleString()} / ${limit.toLocaleString()}`
        : used.toLocaleString(),
    ),
  );
  stats.append(
    statCard("Remaining", number(account.token_remaining).toLocaleString()),
  );
  if (account.ends_at) {
    stats.append(statCard("Renews", String(account.ends_at)));
  }
  container.append(stats);

  if (limit > 0) {
    const track = element("div", "ms-meter");
    const fill = element("div", "ms-meter-fill");
    fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    track.append(fill);
    container.append(track);
    container.append(element("p", "ms-count", `${percent}% of quota used`));
  }

  const user = isRecord(account.user) ? account.user : null;
  if (user?.email) {
    container.append(element("p", "ms-count", String(user.email)));
  }
  return container;
});

onToolOutput(render);
