import { MarketingCampaign } from "../../@types";


// ───────────────── Marketing Instructions Builder ─────────────────
export function buildMarketingInstructions(campaign: MarketingCampaign): string {
  return `
YOU ARE AN OUTBOUND MARKETING CALL AGENT for ${campaign.name}.

YOUR GOAL:
Make a friendly marketing call to inform the customer about our current promotion and try to get them interested.

CAMPAIGN DETAILS:
${campaign.prompt}

CONVERSATION FLOW:
1. GREETING: "Hi there! This is [name] calling from ${campaign.name}. How are you today?"
2. Wait for their response.
3. PERMISSION: "Do you have a quick moment to hear about a special offer we have?"
4. If they say YES/SURE/OK: Explain the promotion enthusiastically.
5. After explaining: "Would you be interested in placing an order or stopping by?"
6. If they show interest: Help them with details, answer questions about menu, hours, etc.
7. ONLY end when they explicitly say goodbye.

VOICE & STYLE:
- Speak naturally, like a real person on the phone
- Keep sentences short (1-2 sentences at a time)
- Be warm and friendly, not pushy
- Pronounce prices and percentages in words ("fifty percent off")

EXTREMELY IMPORTANT - DO NOT END THE CALL PREMATURELY:
- "Yes" or "Sure" or "OK" means they want to HEAR MORE, not end the call!
- "Thank you" is just politeness - keep the conversation going!
- "Interesting" or "That sounds good" means they're engaged - tell them more!
- ONLY use the end_call function when the customer says EXACTLY one of these:
  * "Goodbye" / "Bye" / "Bye bye"
  * "Not interested" / "No thanks" / "No thank you" 
  * "Stop calling" / "Don't call me"
  * "I have to go now" / "Gotta go"
  * "Please hang up" / "End the call"

If you're unsure whether to end: ASK "Is there anything else you'd like to know about our offer?"

NEVER end the call when customer says:
- "Yes" / "Sure" / "OK" / "Okay" (these mean CONTINUE talking)
- "Thank you" / "Thanks" (this is just polite)
- "That sounds good" / "Interesting" (they want more info)
- Any question (answer it first!)

OTHER RULES:
- If they're busy: "No problem! When would be a better time to call back?"
- If they ask a question: Answer it, then ask if they want to order
- Never reveal you are an AI unless directly asked
- Stay on topic - only discuss the campaign and promotion

RESPONSE FORMAT:
Respond with natural conversational speech only. No JSON, no internal states.
Speak as if you're on a real phone call.

Begin with a friendly greeting now.

Always speak in Greek.
Always speak in a friendly and professional tone.
Always speak in a natural and conversational tone.
`;
}

// export function determineOutcome(conversation: Array<{ role: string; message: string }>): { outcome: string; summary: string } {
//   const customerMessages = conversation
//     .filter(c => c.role === "customer")
//     .map(c => c.message.toLowerCase().trim());

//   // Determine outcome
//   if (customerMessages.length === 0) {
//     return { outcome: "no_answer", summary: "Customer did not respond during the call." };
//   }

//   // Strong "not interested" indicators - these are definitive rejections
//   const strongNotInterestedPhrases = [
//     "not interested", "not interesting", "no interest", "dont want", "don't want",
//     "stop calling", "don't call", "do not call", "remove me", "take me off",
//     "leave me alone", "waste of time", "scam", "spam", "hang up", "hanging up",
//     "not for me", "no way", "absolutely not", "never", "go away"
//   ];

//   // Moderate "not interested" indicators
//   const moderateNotInterestedPhrases = [
//     "no thanks", "no thank you", "not right now", "maybe later", "busy right now",
//     "don't need", "do not need", "already have", "not today", "call back later",
//     "i'm good", "im good", "no need", "pass"
//   ];

//   // End-of-call phrases (neutral but indicate ending)
//   const endCallPhrases = ["goodbye", "bye-bye", "bye bye", "bye"];

//   // Strong "interested" indicators - definitive interest
//   const strongInterestedPhrases = [
//     "i want to order", "i'd like to order", "place an order", "take my order",
//     "i'll buy", "i will buy", "sign me up", "count me in", "i'm in", "im in",
//     "tell me more", "how do i order", "where can i get", "send me details",
//     "very interested", "definitely interested", "sounds great", "sounds perfect",
//     "i'll take it", "i will take it", "book it", "reserve"
//   ];

//   // Moderate "interested" indicators (contextual acknowledgments)
//   const moderateInterestedPhrases = [
//     "sounds good", "that's great", "awesome", "perfect", "excellent",
//     "what time", "where are you located", "how much does it cost",
//     "what's the price", "tell me about"
//   ];

//   // Neutral phrases that should NOT count as interest
//   const neutralPhrases = ["okay", "ok", "sure", "yes", "yeah", "hello", "hi", "thank you", "thanks"];

//   // Helper function to check if text contains any phrase from array
//   const containsAny = (text: string, phrases: string[]): boolean => {
//     return phrases.some(phrase => text.includes(phrase));
//   };

//   // Get last 3 messages - these are most important for determining final sentiment
//   const lastMessages = customerMessages.slice(-3);
//   const lastMessage = customerMessages[customerMessages.length - 1] || "";
//   const allText = customerMessages.join(" ");

//   // PRIORITY 1: Check last message for strong rejection (highest priority)
//   if (containsAny(lastMessage, strongNotInterestedPhrases)) {
//     return {
//       outcome: "not_interested",
//       summary: `Customer clearly declined. Final response: "${lastMessage}"`
//     };
//   }

//   // PRIORITY 2: Check last 3 messages for strong rejection
//   const lastThreeText = lastMessages.join(" ");
//   if (containsAny(lastThreeText, strongNotInterestedPhrases)) {
//     return {
//       outcome: "not_interested",
//       summary: `Customer declined the offer. Key responses: ${lastMessages.join("; ")}`
//     };
//   }

//   // PRIORITY 3: Check for strong interest in recent messages
//   if (containsAny(lastThreeText, strongInterestedPhrases)) {
//     return {
//       outcome: "interested",
//       summary: `Customer showed strong interest. Key responses: ${lastMessages.join("; ")}`
//     };
//   }

//   // PRIORITY 4: Check last message for moderate rejection
//   if (containsAny(lastMessage, moderateNotInterestedPhrases)) {
//     return {
//       outcome: "not_interested",
//       summary: `Customer declined the offer. Final response: "${lastMessage}"`
//     };
//   }

//   // PRIORITY 5: Check for moderate interest with no rejection signals
//   const hasModerateInterest = containsAny(allText, moderateInterestedPhrases);
//   const hasAnyRejection = containsAny(allText, [...strongNotInterestedPhrases, ...moderateNotInterestedPhrases]);

//   if (hasModerateInterest && !hasAnyRejection) {
//     return {
//       outcome: "interested",
//       summary: `Customer showed interest in the promotion. Key responses: ${lastMessages.join("; ")}`
//     };
//   }

//   // PRIORITY 6: If last message is just "bye" with no other context, mark as not interested
//   if (containsAny(lastMessage, endCallPhrases) && lastMessage.length < 15) {
//     return {
//       outcome: "not_interested",
//       summary: `Customer ended call without expressing interest. Final response: "${lastMessage}"`
//     };
//   }

//   // PRIORITY 7: Check if conversation was just neutral acknowledgments
//   const nonNeutralMessages = customerMessages.filter(msg => !neutralPhrases.includes(msg.trim()));
//   if (nonNeutralMessages.length === 0) {
//     return {
//       outcome: "not_interested",
//       summary: `Customer gave only neutral responses without clear interest. Responses: ${customerMessages.join("; ")}`
//     };
//   }

//   // Default: If we can't determine, lean towards not_interested
//   return {
//     outcome: "not_interested",
//     summary: `Call ended without clear commitment. Last responses: ${lastMessages.join("; ")}`
//   };
// }



export function determineOutcome(conversation: Array<{ role: string; message: string }>): { outcome: string; summary: string } {
  const customerMessages = conversation
    .filter(c => c.role === "customer")
    .map(c => c.message.toLowerCase().trim());

  // Determine outcome
  if (customerMessages.length === 0) {
    return { outcome: "no_answer", summary: "Customer did not respond during the call." };
  }

  // Strong "not interested" indicators - these are definitive rejections
  // English + Greek
  const strongNotInterestedPhrases = [
    // English
    "not interested", "not interesting", "no interest", "dont want", "don't want",
    "stop calling", "don't call", "do not call", "remove me", "take me off",
    "leave me alone", "waste of time", "scam", "spam", "hang up", "hanging up",
    "not for me", "no way", "absolutely not", "never", "go away",
    // Greek
    "δεν ενδιαφέρομαι", "δεν με ενδιαφέρει", "δεν θέλω", "σταμάτα να με καλείς",
    "μην με καλείς", "άσε με ήσυχο", "άφησέ με", "δεν χρειάζομαι", "όχι ευχαριστώ",
    "ποτέ", "φύγε", "απάτη", "spam", "κλείσε", "κλείσε το τηλέφωνο",
    "δεν είναι για μένα", "με κανέναν τρόπο", "απολύτως όχι"
  ];

  // Moderate "not interested" indicators
  // English + Greek
  const moderateNotInterestedPhrases = [
    // English
    "no thanks", "no thank you", "not right now", "maybe later", "busy right now",
    "don't need", "do not need", "already have", "not today", "call back later",
    "i'm good", "im good", "no need", "pass",
    // Greek
    "όχι ευχαριστώ", "όχι τώρα", "ίσως αργότερα", "είμαι απασχολημένος",
    "δεν χρειάζομαι", "έχω ήδη", "όχι σήμερα", "κάλεσε αργότερα",
    "είμαι εντάξει", "δεν χρειάζεται", "όχι", "όχι τώρα"
  ];

  // End-of-call phrases (neutral but indicate ending)
  // English + Greek
  const endCallPhrases = [
    // English
    "goodbye", "bye-bye", "bye bye", "bye",
    // Greek
    "αντίο", "γεια", "γεια σου", "γεια σας", "τα λέμε", "θα τα πούμε"
  ];

  // Strong "interested" indicators - definitive interest
  // English + Greek
  const strongInterestedPhrases = [
    // English
    "i want to order", "i'd like to order", "place an order", "take my order",
    "i'll buy", "i will buy", "sign me up", "count me in", "i'm in", "im in",
    "tell me more", "how do i order", "where can i get", "send me details",
    "very interested", "definitely interested", "sounds great", "sounds perfect",
    "i'll take it", "i will take it", "book it", "reserve",
    // Greek
    "θέλω να παραγγείλω", "θα ήθελα να παραγγείλω", "πάρε την παραγγελία μου",
    "θα αγοράσω", "γράψε με", "μετράω", "είμαι μέσα", "πες μου περισσότερα",
    "πώς παραγγέλνω", "πού μπορώ να πάρω", "στείλε μου λεπτομέρειες",
    "πολύ ενδιαφέρομαι", "σίγουρα ενδιαφέρομαι", "ακούγεται υπέροχο",
    "θα το πάρω", "κράτησε", "κάνε κράτηση", "κράτησέ το",
    "πολύ ενδιαφέρει", "σίγουρα ενδιαφέρει", "πολύ μου ενδιαφέρει"
  ];

  // Moderate "interested" indicators (contextual acknowledgments)
  // English + Greek
  const moderateInterestedPhrases = [
    // English
    "sounds good", "that's great", "awesome", "perfect", "excellent",
    "what time", "where are you located", "how much does it cost",
    "what's the price", "tell me about", "interested",
    // Greek - Multiple variations of "I'm interested"
    "ενδιαφέρομαι", "ενδιαφέρει", "μου ενδιαφέρει", "μ' ενδιαφέρει",
    "ενδιαφερόμενος", "ενδιαφερόμενη", "ενδιαφερόμαστε",
    "ακούγεται καλό", "αυτό είναι υπέροχο", "τέλειο", "εξαιρετικό",
    "τι ώρα", "πού βρίσκεστε", "πόσο κοστίζει", "ποια είναι η τιμή",
    "πες μου για", "μου αρέσει", "καλή ιδέα", "ναι ενδιαφέρομαι",
    "ναι μου ενδιαφέρει", "ναι ενδιαφέρει"
  ];

  // Neutral phrases that should NOT count as interest
  // English + Greek
  const neutralPhrases = [
    // English
    "okay", "ok", "sure", "yes", "yeah", "hello", "hi", "thank you", "thanks",
    // Greek
    "εντάξει", "οκ", "ναι", "γεια", "γεια σου", "γεια σας", "ευχαριστώ",
    "ευχαριστώ πολύ", "παρακαλώ", "εντάξει", "καλά"
  ];

  // Helper function to check if text contains any phrase from array
  // Normalizes text by removing punctuation for better matching
  const normalizeText = (text: string): string => {
    return text
      .replace(/[.,!?;:]/g, ' ')  // Replace punctuation with spaces
      .replace(/\s+/g, ' ')       // Normalize whitespace
      .trim();
  };

  const containsAny = (text: string, phrases: string[]): boolean => {
    const normalizedText = normalizeText(text);
    return phrases.some(phrase => {
      const normalizedPhrase = normalizeText(phrase);
      return normalizedText.includes(normalizedPhrase);
    });
  };

  // Get last 3 messages - these are most important for determining final sentiment
  const lastMessages = customerMessages.slice(-3);
  const lastMessage = customerMessages[customerMessages.length - 1] || "";
  const allText = customerMessages.join(" ");

  // PRIORITY 1: Check last message for strong rejection (highest priority)
  if (containsAny(lastMessage, strongNotInterestedPhrases)) {
    return {
      outcome: "not_interested",
      summary: `Customer clearly declined. Final response: "${lastMessage}"`
    };
  }

  // PRIORITY 2: Check last 3 messages for strong rejection
  const lastThreeText = lastMessages.join(" ");
  if (containsAny(lastThreeText, strongNotInterestedPhrases)) {
    return {
      outcome: "not_interested",
      summary: `Customer declined the offer. Key responses: ${lastMessages.join("; ")}`
    };
  }

  // PRIORITY 3: Check for strong interest in recent messages
  if (containsAny(lastThreeText, strongInterestedPhrases)) {
    return {
      outcome: "interested",
      summary: `Customer showed strong interest. Key responses: ${lastMessages.join("; ")}`
    };
  }

  // PRIORITY 4: Check last message for moderate interest (before checking rejection)
  // This catches cases like "Μου ενδιαφέρει" (I'm interested)
  if (containsAny(lastMessage, moderateInterestedPhrases)) {
    // Only return interested if there's no strong rejection
    const hasStrongRejection = containsAny(allText, strongNotInterestedPhrases);
    if (!hasStrongRejection) {
      return {
        outcome: "interested",
        summary: `Customer expressed interest. Final response: "${lastMessage}"`
      };
    }
  }

  // PRIORITY 5: Check last message for moderate rejection
  if (containsAny(lastMessage, moderateNotInterestedPhrases)) {
    return {
      outcome: "not_interested",
      summary: `Customer declined the offer. Final response: "${lastMessage}"`
    };
  }

  // PRIORITY 6: Check for moderate interest anywhere in conversation with no rejection signals
  const hasModerateInterest = containsAny(allText, moderateInterestedPhrases);
  const hasAnyRejection = containsAny(allText, [...strongNotInterestedPhrases, ...moderateNotInterestedPhrases]);

  if (hasModerateInterest && !hasAnyRejection) {
    return {
      outcome: "interested",
      summary: `Customer showed interest in the promotion. Key responses: ${lastMessages.join("; ")}`
    };
  }

  // PRIORITY 7: If last message is just "bye" with no other context, mark as not interested
  if (containsAny(lastMessage, endCallPhrases) && lastMessage.length < 15) {
    return {
      outcome: "not_interested",
      summary: `Customer ended call without expressing interest. Final response: "${lastMessage}"`
    };
  }

  // PRIORITY 8: Check if conversation was just neutral acknowledgments
  const nonNeutralMessages = customerMessages.filter(msg => !neutralPhrases.includes(msg.trim()));
  if (nonNeutralMessages.length === 0) {
    return {
      outcome: "not_interested",
      summary: `Customer gave only neutral responses without clear interest. Responses: ${customerMessages.join("; ")}`
    };
  }

  // Default: If we can't determine, lean towards not_interested
  return {
    outcome: "not_interested",
    summary: `Call ended without clear commitment. Last responses: ${lastMessages.join("; ")}`
  };
}