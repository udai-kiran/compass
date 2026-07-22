import type { IconName } from "../components/icons.tsx";

/** Product identity + marketing copy, shared by the landing and signup panes. */
export const PRODUCT = {
  name: "Compass",
  tagline: "Your whole financial life, in focus.",
  blurb:
    "Compass is a private, self-hosted money hub for India — accounts, credit cards, " +
    "loans, investments, and insurance in one place. It reads your bank and card emails, " +
    "drafts the transactions for you to review, and turns the mess into budgets, net worth, " +
    "and clear insights.",
} as const;

export interface Feature {
  icon: IconName;
  title: string;
  description: string;
}

/** Highlights shown on the landing / signup hero. */
export const FEATURES: Feature[] = [
  {
    icon: "inbox",
    title: "Email-powered inbox",
    description: "Bank & card alerts and statements become reviewable transaction drafts — no manual entry.",
  },
  {
    icon: "networth",
    title: "Everything, one net worth",
    description: "Accounts, cards, loans, mutual funds, gold, NPS and insurance roll up into a single picture.",
  },
  {
    icon: "budgets",
    title: "Budgets & cash flow",
    description: "See where money goes, set budgets, and track bills and subscriptions before they hit.",
  },
  {
    icon: "insights",
    title: "Insights that matter",
    description: "Trends, reports, capital-gains and reminders — the analysis done for you.",
  },
  {
    icon: "cards",
    title: "Credit-card intelligence",
    description: "Statement reconciliation, reward points and due-date reminders across every card.",
  },
  {
    icon: "shield",
    title: "Private & self-hosted",
    description: "Your data stays on your own instance. Bring your own AI provider, or none at all.",
  },
];
