/**
 * Machine automation: ingest docs, extract (AI/OCR), redact, confidence, route.
 * When KYC_MACHINE_PROVIDER=none, skips extraction and routes to human review.
 */
import OpenAI from "openai";
import { prisma } from "../../config/database";
import { config } from "../../config/env";
import { logger } from "../../config/logger";
import { afterMachineProcessing } from "./applicationService";
import { getDocumentBuffer } from "./storage";
import type { MachineExtractedPayload, MachineRedactedPayload } from "./types";

const PROVIDER = config.kyc.machineProvider;

/**
 * Process a KYC application: extract, redact, score confidence, then auto-approve or route to human.
 */
export async function processApplication(applicationId: string): Promise<void> {
  const app = await prisma.kycApplication.findUnique({
    where: { id: applicationId },
    include: { documents: true },
  });
  if (!app || app.status !== "machine_processing") {
    logger.warn("processApplication: app not found or not machine_processing", {
      applicationId,
    });
    return;
  }
  let extracted: MachineExtractedPayload = {};
  let redacted: MachineRedactedPayload = { hints: [], unreadableRegions: [] };
  let confidence = 0;

  if (PROVIDER === "none") {
    redacted = {
      hints: ["machine_provider_disabled"],
      unreadableRegions: ["all"],
    };
    confidence = 0;
  } else if (PROVIDER === "openai" && config.kyc.openaiApiKey) {
    const out = await extractWithOpenAI(app.documents);
    extracted = out.extracted;
    redacted = out.redacted;
    confidence = out.confidence;
  } else {
    redacted = { hints: ["provider_unavailable"], unreadableRegions: ["all"] };
    confidence = 0;
  }

  await afterMachineProcessing(applicationId, confidence, redacted, extracted);
}

/**
 * OpenAI Vision-based extraction: fetches document images from storage,
 * sends them to GPT-4o for structured data extraction, then computes a
 * confidence score based on how many fields were successfully extracted.
 */
async function extractWithOpenAI(
  documents: { kind: string; storageRef: string }[],
): Promise<{
  extracted: MachineExtractedPayload;
  redacted: MachineRedactedPayload;
  confidence: number;
}> {
  const openai = new OpenAI({ apiKey: config.kyc.openaiApiKey });

  // Fetch document images from object storage
  const imageContents: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  const hints: string[] = [];

  for (const doc of documents) {
    try {
      const buffer = await getDocumentBuffer(doc.storageRef);
      const base64 = buffer.toString("base64");
      const mimeType = doc.kind === "selfie" ? "image/jpeg" : "image/png";

      imageContents.push({
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${base64}`,
          detail: "high",
        },
      });
      hints.push(`${doc.kind}_uploaded`);
    } catch (err) {
      logger.warn(`Failed to fetch document ${doc.kind} from storage`, { err });
      hints.push(`${doc.kind}_fetch_failed`);
    }
  }

  if (imageContents.length === 0) {
    logger.warn("No documents could be fetched from storage for extraction");
    return {
      extracted: {},
      redacted: { hints, unreadableRegions: ["all"] },
      confidence: 0,
    };
  }

  // Call OpenAI Vision to extract structured data
  let extracted: MachineExtractedPayload = {};
  const unreadableRegions: string[] = [];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1000,
      messages: [
        {
          role: "system",
          content:
            "You are a KYC document extraction assistant. Extract structured identity data from the provided document images. " +
            "Return ONLY valid JSON with these fields (omit any field you cannot read): " +
            '{"documentType": "passport|national_id|drivers_license", "name": "full legal name", ' +
            '"dateOfBirth": "YYYY-MM-DD", "documentNumber": "the ID number", "nationality": "country name"}. ' +
            "If a field is unreadable or obscured, do not include it. Do not hallucinate data.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the identity information from these KYC documents:",
            },
            ...imageContents,
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim() ?? "";

    // Parse the JSON response, stripping markdown code fences if present
    const jsonStr = content
      .replace(/^```json?\s*/i, "")
      .replace(/\s*```$/i, "");
    const parsed = JSON.parse(jsonStr);

    extracted = {
      documentType: parsed.documentType ?? undefined,
      name: parsed.name ?? undefined,
      dateOfBirth: parsed.dateOfBirth ?? undefined,
      documentNumber: parsed.documentNumber ?? undefined,
      nationality: parsed.nationality ?? undefined,
    };

    // Track which fields were extracted for hint reporting
    if (extracted.name) hints.push("name_extracted");
    if (extracted.dateOfBirth) hints.push("dob_extracted");
    if (extracted.documentNumber) hints.push("doc_number_extracted");
    if (extracted.documentType) hints.push("doc_type_extracted");
    if (extracted.nationality) hints.push("nationality_extracted");
  } catch (err) {
    logger.error("OpenAI Vision extraction failed", { err });
    unreadableRegions.push("all");
    hints.push("extraction_error");
  }

  // Compute confidence based on number of fields extracted (5 possible fields)
  const fieldCount = [
    extracted.documentType,
    extracted.name,
    extracted.dateOfBirth,
    extracted.documentNumber,
    extracted.nationality,
  ].filter(Boolean).length;

  const hasIdDoc = documents.some(
    (d) => d.kind === "id_front" || d.kind === "id_back",
  );
  const hasSelfie = documents.some((d) => d.kind === "selfie");
  const docBonus = hasIdDoc && hasSelfie ? 0.05 : 0;

  // Base: 0.2 per field (max 1.0) + bonus for complete doc set
  const confidence = Math.min(1, fieldCount * 0.2 + docBonus);

  const redacted: MachineRedactedPayload = {
    hints,
    unreadableRegions,
  };

  logger.info("OpenAI extraction complete", {
    fieldCount,
    confidence,
    hints,
  });

  return { extracted, redacted, confidence };
}
