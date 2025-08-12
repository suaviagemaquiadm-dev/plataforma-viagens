// Importa as ferramentas necessárias
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {onCall} = require("firebase-functions/v2/https"); // Nova ferramenta para pagamentos
const {initializeApp} = require("firebase-admin/app");
const {setGlobalOptions} = require("firebase-functions/v2");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const twilio = require("twilio");
const mercadopago = require("mercadopago"); // Novo "ingrediente": Mercado Pago

// Inicializa a ligação segura com o nosso projeto
initializeApp();
setGlobalOptions({maxInstances: 10});

// --- SEGREDOS DO TWILIO (para o robô de notificações) ---
const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioWhatsappFrom = defineSecret("TWILIO_WHATSAPP_FROM");
const adminWhatsappTo = defineSecret("ADMIN_WHATSAPP_TO");

// --- SEGREDOS DO MERCADO PAGO (para o robô de pagamentos) ---
const mpAccessToken = defineSecret("MERCADO_PAGO_ACCESS_TOKEN");


// --- ROBÔ 1: Notificar Novo Anúncio ---
exports.notificarNovoAnuncio = onDocumentCreated({
  document: "partners/{partnerId}",
  secrets: [twilioAccountSid, twilioAuthToken, twilioWhatsappFrom, adminWhatsappTo]
}, async (event) => {
  const partnerData = event.data.data();
  const nomeDoNegocio = partnerData.name;
  const mensagem = `📢 Novo anúncio para aprovação!\n\n*Negócio:* ${nomeDoNegocio}\n\nPor favor, acesse o painel para aprovar.`;
  const twilioClient = twilio(twilioAccountSid.value(), twilioAuthToken.value());

  logger.info(`A tentar enviar notificação para ${adminWhatsappTo.value()}...`);
  try {
    await twilioClient.messages.create({
      from: twilioWhatsappFrom.value(),
      to: adminWhatsappTo.value(),
      body: mensagem
    });
    logger.info("Mensagem de WhatsApp enviada com sucesso!");
  } catch (error) {
    logger.error("Erro ao enviar mensagem de WhatsApp:", error);
  }
  return event.data.ref.set({ status: "aguardando_aprovacao" }, {merge: true});
});


// --- ROBÔ 2: Criar Fatura de Pagamento (Gerente Financeiro) ---
exports.criarPreferenciaDePagamento = onCall({
  secrets: [mpAccessToken]
}, async (request) => {
  // Configura o Mercado Pago com a nossa "senha" (Access Token)
  mercadopago.configure({ access_token: mpAccessToken.value() });

  // Pega nos dados do plano que o cliente escolheu (ex: nome e preço)
  const planData = request.data;

  const preference = {
    items: [
      {
        title: planData.title,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: planData.price
      }
    ],
    back_urls: {
        success: "https://suaviagemaquiadm-dev.github.io/plataforma-viagens/", // Página para onde o cliente volta após pagar
        failure: "https://suaviagemaquiadm-dev.github.io/plataforma-viagens/",
        pending: "https://suaviagemaquiadm-dev.github.io/plataforma-viagens/"
    },
    auto_return: "approved"
  };

  try {
    logger.info("A criar preferência de pagamento...");
    const response = await mercadopago.preferences.create(preference);
    logger.info("Preferência criada com sucesso!");
    // Devolve o link de pagamento para o site
    return { preferenceId: response.body.id };
  } catch (error) {
    logger.error("Erro ao criar preferência no Mercado Pago:", error);
    throw new functions.https.HttpsError('internal', 'Não foi possível criar a preferência de pagamento.');
  }
});

