import sgMail from "@sendgrid/mail";
import { config } from "../config.js";

let initialized = false;
function init() {
  if (initialized) return;
  if (!config.sendgridApiKey) {
    throw new Error(
      "SENDGRID_API_KEY_PATH is not set or file missing — cannot send. " +
        "In development you can set NODE_ENV=development and use the stub sender.",
    );
  }
  sgMail.setApiKey(config.sendgridApiKey);
  initialized = true;
}

export interface SendArgs {
  to: string;
  toName?: string;
  subject: string;
  templateId?: string;            // SendGrid Dynamic Template ID
  dynamicTemplateData?: Record<string, unknown>;
  htmlBody?: string;              // fallback if template not yet uploaded
  textBody?: string;
  customArgs?: Record<string, string>;  // attached to webhook events
  category?: string;              // SendGrid category for analytics
  unsubscribeGroupId?: number;    // SendGrid unsubscribe group
  asmGroupsToDisplay?: number[];
}

export interface SendResult {
  ok: true;
  messageId: string;
  statusCode: number;
}

export interface SendError {
  ok: false;
  statusCode?: number;
  message: string;
  retryable: boolean;
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export async function sendOne(args: SendArgs): Promise<SendResult | SendError> {
  if (!config.sendgridApiKey) {
    // Stub mode for dev — log and pretend success.
    return {
      ok: true,
      messageId: `stub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      statusCode: 202,
    };
  }
  init();

  const msg: sgMail.MailDataRequired = {
    to: args.toName ? { email: args.to, name: args.toName } : args.to,
    from: { email: config.senderFromEmail, name: config.senderFromName },
    replyTo: config.senderReplyTo,
    subject: args.subject,
    customArgs: args.customArgs,
    category: args.category,
    asm: args.unsubscribeGroupId
      ? { groupId: args.unsubscribeGroupId, groupsToDisplay: args.asmGroupsToDisplay }
      : undefined,
  } as sgMail.MailDataRequired;

  if (args.templateId) {
    (msg as sgMail.MailDataRequired & { templateId?: string }).templateId = args.templateId;
    if (args.dynamicTemplateData) {
      (
        msg as sgMail.MailDataRequired & {
          dynamicTemplateData?: Record<string, unknown>;
        }
      ).dynamicTemplateData = args.dynamicTemplateData;
    }
  } else if (args.htmlBody || args.textBody) {
    const content: { type: string; value: string }[] = [];
    if (args.textBody) content.push({ type: "text/plain", value: args.textBody });
    if (args.htmlBody) content.push({ type: "text/html", value: args.htmlBody });
    (msg as sgMail.MailDataRequired & { content: typeof content }).content = content;
  } else {
    return {
      ok: false,
      message: "Neither templateId nor htmlBody/textBody provided",
      retryable: false,
    };
  }

  try {
    const [response] = await sgMail.send(msg);
    const messageId = response.headers["x-message-id"] ?? "";
    return { ok: true, messageId: String(messageId), statusCode: response.statusCode };
  } catch (err) {
    const e = err as { code?: number; message?: string; response?: { body?: unknown } };
    const status = e.code;
    const retryable = status ? RETRYABLE_STATUSES.has(status) : true; // network errs retryable
    return {
      ok: false,
      statusCode: status,
      message:
        (typeof e.response?.body === "object" && e.response?.body
          ? JSON.stringify(e.response.body)
          : e.message) ?? "unknown SendGrid error",
      retryable,
    };
  }
}
