/**
 * Import function triggers from their respective sub-packages:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {
  onCall,
  onRequest,
} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const {
  initializeApp
} = require("firebase-admin/app");
const {
  getFirestore
} = require("firebase-admin/firestore");
const {
  defineString
} = require('firebase-functions/params');
const {
  getAuth
} = require('firebase-admin/auth');
const {
  Twilio
} = require('twilio');

// Inicializa o Firebase Admin SDK
initializeApp();
const db = getFirestore();
const adminAuth = getAuth();


// --- Definição de Segredos e Configurações ---
// Para configurar, execute no terminal:
// firebase functions:secrets:set MERCADO_PAGO_ACCESS_TOKEN
// firebase functions:secrets:set TWILIO_ACCOUNT_SID
// firebase functions:secrets:set TWILIO_AUTH_TOKEN
const mercadoPagoAccessToken = defineString("MERCADO_PAGO_ACCESS_TOKEN");
const twilioAccountSid = defineString("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineString("TWILIO_AUTH_TOKEN");

// --- FUNÇÃO 1: Notificar Novo Anúncio via WhatsApp ---
exports.notificarNovoAnuncio = onCall(async (request) => {
  const {
    nomeAnunciante,
    email,
    telefone
  } = request.data;
  logger.info(`Nova notificação de anúncio para: ${nomeAnunciante}`);

  const client = new Twilio(twilioAccountSid.value(), twilioAuthToken.value());
  const adminPhoneNumber = "whatsapp:+5512981329343"; // Seu número de WhatsApp (admin)
  const twilioSandboxNumber = "whatsapp:+14155238886"; // Número do Sandbox do Twilio

  const message = `🔔 *Novo Anunciante Cadastrado* 🔔\n\n*Nome:* ${nomeAnunciante}\n*Email:* ${email}\n*Telefone:* ${telefone}\n\nAcesse o painel de administrador para aprovar.`;

  try {
    await client.messages.create({
      body: message,
      from: twilioSandboxNumber,
      to: adminPhoneNumber,
    });
    logger.info("Mensagem do WhatsApp enviada com sucesso!");
    return {
      success: true,
      message: "Notificação enviada."
    };
  } catch (error) {
    logger.error("Erro ao enviar mensagem do WhatsApp:", error);
    throw new onCall.HttpsError("internal", "Erro ao enviar notificação.");
  }
});


// --- FUNÇÃO 2 (ATUALIZADA): Criar Preferência de Pagamento ---
exports.criarPreferenciaDePagamento = onCall({
  secrets: ["MERCADO_PAGO_ACCESS_TOKEN"]
}, async (request) => {
  if (!request.auth) {
    throw new onCall.HttpsError("unauthenticated", "Você precisa estar autenticado.");
  }

  const {
    title,
    price,
    userId,
    plan
  } = request.data;
  logger.info(`Criando preferência para userId: ${userId}, plano: ${plan}`);

  const siteUrl = "https://www.suaviagemaqui.com.br";
  // IMPORTANTE: Este URL precisa ser o URL público da sua função de webhook.
  // Você o obtém no painel do Firebase após o primeiro deploy da função.
  const notification_url = "https://mercadopagowebhook-cg5v65japa-uc.a.run.app"; // Substitua por seu URL real

  const body = {
    items: [{
      title: title,
      quantity: 1,
      unit_price: price,
      currency_id: "BRL",
    }, ],
    back_urls: {
      success: `${siteUrl}/success.html`,
      failure: `${siteUrl}/failure.html`,
      pending: `${siteUrl}/pending.html`,
    },
    auto_return: "approved",
    external_reference: JSON.stringify({
      userId: userId,
      plan: plan,
    }),
    notification_url: notification_url,
  };

  try {
    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${mercadoPagoAccessToken.value()}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    logger.info("Preferência criada:", data);
    return {
      preferenceId: data.id
    };
  } catch (error) {
    logger.error("Erro ao criar preferência no Mercado Pago:", error);
    throw new onCall.HttpsError("internal", "Não foi possível criar a preferência de pagamento.");
  }
});


// --- FUNÇÃO 3 (NOVA): Webhook do Mercado Pago ---
exports.mercadoPagoWebhook = onRequest({
  secrets: ["MERCADO_PAGO_ACCESS_TOKEN"]
}, async (req, res) => {
  logger.info("Webhook do Mercado Pago recebido!");
  const topic = req.query.topic || req.body.topic;
  const paymentId = req.query.id || req.body.data?.id;

  if (topic === "payment" && paymentId) {
    logger.info(`Evento de pagamento recebido para o ID: ${paymentId}`);
    try {
      const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          "Authorization": `Bearer ${mercadoPagoAccessToken.value()}`,
        },
      });
      const payment = await paymentResponse.json();

      if (payment.status === "approved") {
        logger.info("Pagamento APROVADO!");
        const externalReference = JSON.parse(payment.external_reference);
        const {
          userId,
          plan
        } = externalReference;

        if (!userId || !plan) {
          throw new Error("external_reference inválida ou ausente.");
        }

        logger.info(`Atualizando parceiro. UserID: ${userId}, Plano: ${plan}`);
        const partnerRef = db.collection("partners").doc(userId);
        await partnerRef.update({
          plan: plan,
          status: "aprovado",
          paymentStatus: "pago",
          lastPaymentId: paymentId,
          planUpdatedAt: new Date(),
        });
        logger.info(`Parceiro ${userId} atualizado com sucesso para o plano ${plan}!`);
      }
      res.status(200).send("Webhook recebido com sucesso.");
    } catch (error) {
      logger.error("Erro ao processar webhook:", error);
      res.status(500).send("Erro interno ao processar webhook.");
    }
  } else {
    res.status(200).send("Notificação não relevante.");
  }
});

// --- FUNÇÃO 4 (NOVA): Gerar Roteiro com IA ---
exports.gerarRoteiro = onCall(async (request) => {
  const {
    prompt
  } = request.data;
  if (!prompt) {
    throw new onCall.HttpsError("invalid-argument", "O prompt não pode estar vazio.");
  }

  // AINDA A SER IMPLEMENTADO: A lógica para chamar a API do Gemini
  // Por agora, retornamos um texto de exemplo.
  logger.info(`Gerando roteiro para o prompt: ${prompt}`);
  const mockResponse = `
  ### Proposta de Roteiro Gerada por IA

  **Baseado na sua descrição:** _${prompt}_

  ---

  #### **Dia 1-3: A Magia de Roma**
  * **Hospedagem:** Hotel Boutique no charmoso bairro de Trastevere.
  * **Atividades:**
    * Tour privado pelo Coliseu e Fórum Romano para evitar filas.
    * Aula de culinária para aprender a fazer pasta fresca.
    * Jantar romântico com vista para o Panteão.

  #### **Dia 4-6: A Arte de Florença**
  * **Transporte:** Viagem cênica de trem de alta velocidade.
  * **Atividades:**
    * Visita guiada à Galeria Uffizi e à estátua de David de Michelangelo.
    * Passeio de um dia pela região vinícola de Chianti com degustação.
    * Jantar em um restaurante com estrela Michelin.

  *Este é um roteiro de exemplo. Podemos personalizá-lo completamente!*
  `;

  return {
    text: mockResponse
  };
});

