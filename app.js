const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const archiver = require('archiver');
const fetch = require('node-fetch');
const FormData = require('form-data');

const app = express();
const PORTA = process.env.PORT || 3000;
const PERCENTUAL_ADMIN = 5;

// ======================================
// ⚙️ CONFIGURAÇÕES — PRONTAS PARA cPanel
// ======================================
const AMBIENTE = process.env.NODE_ENV || 'development';
const BASE_URL = AMBIENTE === 'production' ? '/aci' : '';

const ENDERECO_SERVIDOR = AMBIENTE === 'production'
  ? "https://portalregionalcampinas.com.br/aci"
  : "http://portalregionalcampinas.com.br/aci/servidor";

const IP_PDV_PADRAO = "192.168.15.82:5000";
const LINK_VITRINE_PUBLICO = AMBIENTE === 'production'
  ? "https://portalregionalcampinas.com.br/aci/vitrine"
  : "http://localhost:3000/vitrine";

const LINK_PDV_PADRAO = `http://${IP_PDV_PADRAO}`;
const PROTEGER_ROTAS = false;
const SENHA_ADMIN = "8341@";
const FAZER_BACKUP_AUTOMATICO = true;

const statusLojas = {};

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ======================================
// 📂 CAMINHOS DAS PASTAS — CORRIGIDOS
// ======================================
const pastaRaiz           = __dirname;
const pastaServidor       = pastaRaiz;
const pastaAci            = path.resolve(pastaRaiz, '..', 'aci');
const pastaLojas          = path.resolve(pastaRaiz, '..', 'lojas');
const pastaRelatorios     = path.resolve(pastaRaiz, '..', 'relatorios');
const Relatorios          = pastaRelatorios; // ✅ Corrige linha 47
const pastaEntregas       = path.join(pastaRelatorios, 'entregas');
const pastaConfig         = path.resolve(pastaRaiz, '..', 'config');
const pastaCodigosGerados = path.resolve(pastaRaiz, '..', 'codigos_gerados');
const pastaBackups        = path.resolve(pastaRaiz, '..', 'backups');
const pastaUploads        = path.join(pastaRaiz, 'uploads_cnh');
const pastaFotosTemp      = path.join(pastaRaiz, 'fotos_temp');
const pastaModelos        = path.resolve(pastaRaiz, '..', 'vitrine'); // ✅ Pasta das páginas HTML

console.log('========================================');
console.log('🚀 INICIANDO SISTEMA ACI');
console.log('========================================');
console.log('📂 PASTA RAIZ:', pastaRaiz);
console.log('📂 PASTA RELATORIOS:', Relatorios);
console.log('📂 PASTA LOJAS:', pastaLojas);
console.log('📂 PASTA CONFIG:', pastaConfig);
console.log('📂 PASTA UPLOADS:', pastaUploads);
console.log('🌐 AMBIENTE:', AMBIENTE);
console.log('🔗 SERVIDOR:', ENDERECO_SERVIDOR);
console.log('========================================');

const arquivoEntregadores       = path.join(pastaConfig, 'entregadores.json');
const arquivoRelatorios        = path.join(pastaConfig, 'reletorios.json');
const arquivoCadastrosPendentes = path.join(pastaConfig, 'cadastros_pendentes.json');
const arquivoRegistroLojas      = path.join(pastaConfig, 'registro_lojas.json');
const arquivoEntregas           = path.join(pastaConfig, 'entregas.json');

// ======================================
// 📤 CONFIGURAÇÃO DE UPLOAD
// ======================================
const armazenamento = multer.diskStorage({
  destination: (req, file, cb) => cb(null, pastaUploads),
  filename: (req, file, cb) => {
    const nomeSeguro = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, nomeSeguro);
  }
});

const upload = multer({
  storage: armazenamento,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitidos = /jpeg|jpg|png|webp/;
    const ext = permitidos.test(path.extname(file.originalname).toLowerCase());
    const mime = permitidos.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Apenas arquivos de imagem (JPG, JPEG, PNG, WEBP) são permitidos'));
  }
});

const uploadFotoEntrega = multer({ dest: pastaFotosTemp });

// ✅ LIBERA ACESSO PÚBLICO
app.use(`${BASE_URL}/config`, express.static(pastaConfig, { index: false }));
app.use(`${BASE_URL}/uploads_cnh`, express.static(pastaUploads));
app.use(`${BASE_URL}`, express.static(pastaModelos));

// ======================================
// 📁 CRIAR PASTAS E ARQUIVOS
// ======================================
[pastaConfig, pastaLojas, pastaRelatorios, pastaEntregas, pastaCodigosGerados, pastaBackups, pastaUploads, pastaFotosTemp].forEach(pasta => {
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
});

if (!fs.existsSync(arquivoRegistroLojas)) {
  fs.writeFileSync(arquivoRegistroLojas, JSON.stringify({
    descricao: "Registro de lojas cadastradas",
    versao: "1.0",
    lojas: []
  }, null, 2), "utf8");
}
if (!fs.existsSync(arquivoCadastrosPendentes)) {
  fs.writeFileSync(arquivoCadastrosPendentes, JSON.stringify([], null, 2), "utf8");
}
if (!fs.existsSync(arquivoEntregadores)) {
  fs.writeFileSync(arquivoEntregadores, JSON.stringify([], null, 2), "utf8");
}

// ======================================
// 🛡️ FUNÇÕES AUXILIARES
// ======================================
function salvarDadosSeguro(caminho, dados) {
  try {
    const temp = `${caminho}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(dados, null, 2), 'utf8');
    fs.renameSync(temp, caminho);
    return true;
  } catch (erro) {
    if (fs.existsSync(`${caminho}.tmp`)) fs.unlinkSync(`${caminho}.tmp`);
    console.error(`❌ Erro ao salvar ${caminho}:`, erro.message);
    return false;
  }
}

function fazerBackup() {
  if (!FAZER_BACKUP_AUTOMATICO) return;
  try {
    const data = new Date().toISOString().slice(0,19).replace(/[:T]/g, '-');
    const camZip = path.join(pastaBackups, `backup-${data}.zip`);
    const saida = fs.createWriteStream(camZip);
    const zip = archiver('zip', { zlib: { level: 6 } });
    saida.on('close', () => console.log(`💾 Backup salvo: ${camZip} (${(zip.pointer()/1024/1024).toFixed(2)} MB)`));
    zip.on('error', err => console.warn(`⚠️ Falha no backup:`, err.message));
    zip.pipe(saida);
    zip.directory(pastaLojas, 'lojas');
    zip.directory(pastaServidor, 'servidor');
    zip.directory(pastaConfig, 'config');
    zip.directory(pastaRelatorios, 'relatorios');
    zip.directory(pastaUploads, 'fotos_entregadores');
    zip.finalize();
  } catch (erro) {
    console.warn(`⚠️ Falha no backup:`, erro.message);
  }
}

function normalizarTexto(texto) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/ /g, "_");
}

function carregarEntregadores() {
  try {
    if (!fs.existsSync(arquivoEntregadores)) return [];
    const conteudo = fs.readFileSync(arquivoEntregadores, 'utf8').trim();
    return conteudo ? JSON.parse(conteudo) : [];
  } catch (erro) {
    console.warn("⚠️ Arquivo entregadores.json inválido, iniciando vazio:", erro.message);
    return [];
  }
}

function salvarEntregadores(lista) { return salvarDadosSeguro(arquivoEntregadores, lista) }
function carregarPendentes() {
  try {
    if (!fs.existsSync(arquivoCadastrosPendentes)) return [];
    const conteudo = fs.readFileSync(arquivoCadastrosPendentes, 'utf8').trim();
    return conteudo ? JSON.parse(conteudo) : [];
  } catch (erro) {
    console.warn("⚠️ Arquivo cadastros_pendentes.json inválido:", erro.message);
    return [];
  }
}
function salvarPendentes(lista) { return salvarDadosSeguro(arquivoCadastrosPendentes, lista) }
function carregarRegistroLojas() {
  try {
    const dados = JSON.parse(fs.readFileSync(arquivoRegistroLojas, 'utf8'));
    return dados.lojas || [];
  } catch { return []; }
}
function salvarRegistroLojas(listaAtualizada) {
  const dadosCompletos = {
    descricao: "Registro oficial de lojas cadastradas",
    versao: "1.0",
    lojas: listaAtualizada
  };
  return salvarDadosSeguro(arquivoRegistroLojas, dadosCompletos);
}

function calcularValoresDevidos(idLoja) {
  try {
    const camVendas = path.join(pastaLojas, idLoja, 'vendas');
    if (!fs.existsSync(camVendas)) return { total_vendas: 0, comissao: 0, taxa_entregadores: 0, total_devido: 0 };
    const arquivos = fs.readdirSync(camVendas).filter(a => a.endsWith('.json'));
    let totalVendas = 0, taxaEntregadores = 0;
    arquivos.forEach(arq => {
      try {
        const v = JSON.parse(fs.readFileSync(path.join(camVendas, arq), 'utf8'));
        if (!v.ja_fechado && v.origem === "ONLINE") {
          totalVendas += Number(v.valor_total || v.total || 0);
          taxaEntregadores += Number(v.taxa_entrega || v.valores?.entrega || 0);
        }
      } catch {}
    });
    const comissao = (totalVendas * PERCENTUAL_ADMIN) / 100;
    return { total_vendas: totalVendas, comissao, taxa_entregadores: taxaEntregadores, total_devido: comissao + taxaEntregadores };
  } catch {
    return { total_vendas: 0, comissao: 0, taxa_entregadores: 0, total_devido: 0 };
  }
}

function calcularAcertoSemanal(dataInicio = null, dataFim = null) {
  try {
    if (!fs.existsSync(pastaEntregas)) return { erro: "Pasta de entregas não encontrada" };
    const arquivos = fs.readdirSync(pastaEntregas).filter(a => a.endsWith('.json'));
    let total_vendas_produtos = 0;
    let total_taxas_entrega = 0;
    const entregadoresMap = {};
    const hoje = new Date();
    if (!dataInicio || !dataFim) {
      const diaSemana = hoje.getDay();
      dataInicio = new Date(hoje);
      dataInicio.setDate(hoje.getDate() - diaSemana);
      dataInicio.setHours(0, 0, 0, 0);
      dataFim = new Date(dataInicio);
      dataFim.setDate(dataInicio.getDate() + 6);
      dataFim.setHours(23, 59, 59, 999);
    }
    arquivos.forEach(arq => {
      try {
             const entrega = JSON.parse(fs.readFileSync(path.join(pastaEntregas, arq), 'utf8'));
        const dataEntrega = new Date(entrega.data_hora);
        if (dataEntrega >= dataInicio && dataEntrega <= dataFim) {
          const valorProdutos = Number(entrega.valor_total || 0);
          total_vendas_produtos += valorProdutos;
          const taxa = Number(entrega.taxa_entrega || 0);
          total_taxas_entrega += taxa;
          const idEnt = entrega.id_entregador;
          if (idEnt) {
            if (!entregadoresMap[idEnt]) {
              entregadoresMap[idEnt] = {
                id_entregador: idEnt,
                nome: entrega.nome_entregador || 'Não informado',
                quantidade_entregas: 0,
                valor_receber: 0
              };
            }
            entregadoresMap[idEnt].quantidade_entregas++;
            entregadoresMap[idEnt].valor_receber += taxa;
          }
        }
      } catch {}
    });
    const comissaoAdmin = Number((total_vendas_produtos * PERCENTUAL_ADMIN / 100).toFixed(2));
    const listaEntregadores = Object.values(entregadoresMap).map(e => ({
      ...e,
      valor_receber: Number(e.valor_receber.toFixed(2))
    }));
    return {
      periodo: {
        inicio: dataInicio.toLocaleDateString('pt-BR'),
        fim: dataFim.toLocaleDateString('pt-BR')
      },
      total_vendas_produtos: Number(total_vendas_produtos.toFixed(2)),
      comissao_admin_5pct: comissaoAdmin,
      total_taxas_entrega: Number(total_taxas_entrega.toFixed(2)),
      detalhe_entregadores: listaEntregadores
    };
  } catch {
    return { erro: "Falha ao calcular acerto" };
  }
}

function verificarVencimentos() {
  try {
    const hoje = new Date();
    const lojas = carregarRegistroLojas();
    let alterou = false;
    lojas.forEach(loja => {
      if (!loja.pronta_para_exe) return;
      const ultimo = loja.ultimo_acerto ? new Date(loja.ultimo_acerto) : new Date(0);
      const vencimento = new Date(ultimo);
      vencimento.setDate(ultimo.getDate() + 7);
      const valores = calcularValoresDevidos(loja.id);
      if (loja.valor_devido !== valores.total_devido) {
        loja.valor_devido = valores.total_devido;
        alterou = true;
      }
      if (valores.total_devido === 0) {
        if (loja.status_sistema !== "ATIVO" || loja.aviso_enviado !== false) {
          loja.status_sistema = "ATIVO";
          loja.aviso_enviado = false;
          alterou = true;
        }
      } else {
        const umDiaAntes = new Date(vencimento);
        umDiaAntes.setDate(vencimento.getDate() - 1);
        if (hoje >= umDiaAntes && hoje < vencimento && !loja.aviso_enviado) {
          loja.status_sistema = "AVISO";
          loja.aviso_enviado = true;
          alterou = true;
        } else if (hoje >= vencimento && loja.status_sistema !== "BLOQUEADO") {
          loja.status_sistema = "BLOQUEADO";
          alterou = true;
        }
      }
      const camDadosLoja = path.join(pastaLojas, loja.id, 'dados_loja.json');
      if (fs.existsSync(camDadosLoja)) salvarDadosSeguro(camDadosLoja, loja);
    });
    if (alterou) salvarRegistroLojas(lojas);
  } catch (erro) {
    console.error("⚠️ Erro na verificação de vencimentos:", erro.message);
  }
}

setInterval(verificarVencimentos, 24 * 60 * 60 * 1000);
verificarVencimentos();

function verificarAdmin(req, res, next) {
  if (!PROTEGER_ROTAS) return next();
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${SENHA_ADMIN}`) return res.status(403).json({ sucesso: false, erro: "Acesso restrito" });
  next();
}

function rotaPagina(nomeBase, titulo) {
  return (req, res) => {
    const camHTML1 = path.resolve(pastaModelos, nomeBase + '.html');
    const camHTML2 = path.resolve(pastaModelos, nomeBase + '.htm');
    if (fs.existsSync(camHTML1)) return res.sendFile(camHTML1, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (fs.existsSync(camHTML2)) return res.sendFile(camHTML2, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    res.send(`<h2 style="color:red; text-align:center; margin-top:3rem;">❌ Página ${titulo} não encontrada</h2>`);
  };
}

// ======================================
// 📄 ROTAS DE PÁGINAS — COM BASE_URL
// ======================================
app.get(`${BASE_URL}/`, rotaPagina('index', 'Painel Principal'));
app.get(`${BASE_URL}/cadastrar-lojas`, rotaPagina('cadastrar-lojas', 'Cadastrar Lojas'));
app.get(`${BASE_URL}/lojas-cadastradas`, rotaPagina('lojas-cadastradas', 'Lojas Cadastradas'));
app.get(`${BASE_URL}/gerenciar-entregadores`, rotaPagina('gerenciar-entregadores', 'Gerenciar Entregadores'));
app.get(`${BASE_URL}/entregador`, rotaPagina('entregador', 'Cadastro de Entregadores'));
app.get(`${BASE_URL}/entregador-area`, rotaPagina('pedidos', 'Área do Entregador'));
app.get(`${BASE_URL}/vendas-gerais`, rotaPagina('vendas-gerais', 'Vendas Gerais'));
app.get(`${BASE_URL}/prestacao-contas`, rotaPagina('prestacao-contas', 'Prestação de Contas'));
app.get(`${BASE_URL}/relatorios`, rotaPagina('relatorios', 'Relatórios'));
app.get(`${BASE_URL}/configuracoes`, rotaPagina('configuracoes', 'Configurações'));
app.get(`${BASE_URL}/pedidos`, rotaPagina('pedidos', 'Gerenciamento de Pedidos'));
app.get(`${BASE_URL}/entregas.html`, rotaPagina('entregas/entregas', 'Controle de Entregas'));
app.get(`${BASE_URL}/rede-lojas`, (req, res) => res.redirect(`${BASE_URL}/rede_de_lojas.html`));
app.get(`${BASE_URL}/encontrar-lojas`, rotaPagina('rede_de_lojas', 'Lista de Lojas'));

app.get(`${BASE_URL}/pdv/:idLoja`, (req, res) => {
  try {
    const idLoja = req.params.idLoja.trim();
    const loja = carregarRegistroLojas().find(l => l.id === idLoja);
    if (!loja) return res.send(`<h2 style="color:red; text-align:center;">❌ Loja não cadastrada</h2>`);
    const camBase = path.resolve(pastaAci, 'pdv-base.html');
    if (!fs.existsSync(camBase)) return res.send(`<h2 style="color:red; text-align:center;">❌ Modelo PDV não encontrado</h2>`);
    let conteudo = fs.readFileSync(camBase, 'utf8');
    conteudo = conteudo
      .replaceAll('{ID_LOJA}', loja.id)
      .replaceAll('{NOME_LOJA}', loja.nome)
      .replaceAll('{CNPJ_LOJA}', loja.documento)
      .replaceAll('{CHAVE_PIX}', loja.pix?.chave || "")
      .replaceAll('{SERVIDOR}', ENDERECO_SERVIDOR);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(conteudo);
  } catch (erro) {
    res.send(`<h2 style="color:red;">Erro: ${erro.message}</h2>`);
  }
});

// ======================================
// 📡 ROTAS DE COMUNICAÇÃO COM PDV
// ======================================
app.get(`${BASE_URL}/api/ping-por-nome/:nome_loja`, async (req, res) => {
  try {
    const nomeRecebido = normalizarTexto(req.params.nome_loja);
    const lojas = carregarRegistroLojas();
    const loja = lojas.find(l => normalizarTexto(l.nome) === nomeRecebido);
    if (!loja) {
      return res.json({
        nome_original: req.params.nome_loja.replace(/_/g, " "),
        id_loja: null,
        endereco: "Não cadastrado",
        status_led: "vermelho",
        status_texto: "Loja não cadastrada",
        liberar_vitrine: false,
        link_vitrine: "#"
      });
    }
    const enderecoLoja = loja.endereco || "Não informado";
    const statusSistema = loja.status_sistema || "ATIVO";
    const ipPdv = loja.ip_pdv || `http://${IP_PDV_PADRAO}`;
    try {
      const resposta = await fetch(`${ipPdv}/api/ping-por-id/${loja.id}`, {
        timeout: 3000,
        headers: { 'Accept': 'application/json' }
      });
      if (!resposta.ok) throw new Error("Sem resposta do PDV");
      const dadosPdv = await resposta.json();
      res.json({
        nome_original: loja.nome,
        id_loja: loja.id,
        endereco: enderecoLoja,
        status_led: dadosPdv.status_led || "vermelho",
        status_texto: dadosPdv.status_texto || "Online",
        status_sistema: statusSistema,
        liberar_vitrine: dadosPdv.liberar_vitrine || false,
        link_vitrine: dadosPdv.link_vitrine || `${LINK_VITRINE_PUBLICO}/vitrine/${loja.id}`
      });
    } catch {
      res.json({
        nome_original: loja.nome,
        id_loja: loja.id,
        endereco: enderecoLoja,
        status_led: "vermelho",
        status_texto: "Offline / Sem conexão",
        status_sistema: statusSistema,
        liberar_vitrine: false,
        link_vitrine: "#"
      });
    }
  } catch (erro) {
    console.warn("Erro no ping:", erro.message);
    res.json({
      nome_original: req.params.nome_loja.replace(/_/g, " "),
      endereco: "Erro ao carregar",
      status_led: "vermelho",
      status_texto: "Erro interno",
      liberar_vitrine: false
    });
  }
});

app.get(`${BASE_URL}/api/dados-lojas`, (req, res) => {
  try {
    const lojas = carregarRegistroLojas().map(loja => ({
      id: loja.id,
      nome: loja.nome,
      nome_normalizado: normalizarTexto(loja.nome),
      cnpj: loja.documento,
      endereco: loja.endereco,
      status_sistema: loja.status_sistema
    }));
    res.json({ sucesso: true, lojas });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.get(`${BASE_URL}/api/status-loja/:id`, (req, res) => {
  try {
    const id = req.params.id.trim();
    const loja = carregarRegistroLojas().find(l => l.id === id);
    if (!loja) return res.json({ online: false, mensagem: "Loja não cadastrada" });
    const status = statusLojas[id] || {};
    const conectada = status.ultimaAtividade ? (Date.now() - status.ultimaAtividade) < 15000 : false;
    res.json({
      online: conectada && loja.status_sistema === "ATIVO" && (status.recebePedidos !== false && loja.recebePedidos !== false),
      status: loja.status_sistema,
      aceita_pedidos: status.recebePedidos !== undefined ? status.recebePedidos : loja.recebePedidos,
      link_pdv: LINK_PDV_PADRAO
    });
  } catch {
    res.json({ online: false });
  }
});

app.get(`${BASE_URL}/api/lojas-disponiveis`, (req, res) => {
  try {
    const lojas = carregarRegistroLojas()
      .filter(loja => loja.status_sistema === "ATIVO")
      .map(loja => {
        const status = statusLojas[loja.id] || {};
        const conectada = status.ultimaAtividade ? (Date.now() - status.ultimaAtividade) < 15000 : false;
        return {
          id_loja: loja.id,
          nome: loja.nome,
          endereco: loja.endereco,
          cidade: loja.cidade || "Campinas",
          aceita_pedidos: status.recebePedidos !== undefined ? status.recebePedidos : loja.recebePedidos !== undefined ? loja.recebePedidos : true,
          conectada: conectada,
          url_pdv: `${LINK_PDV_PADRAO}/${loja.id}`,
          status: loja.status_sistema
        };
      });
    res.json({ sucesso: true, lojas });
  } catch (erro) {
    res.json({ sucesso: false, mensagem: "Erro ao carregar lojas", erro: erro.message });
  }
});

app.post(`${BASE_URL}/api/loja/atualizar-status`, express.json(), (req, res) => {
  try {
    const { id_loja, ativo } = req.body;
    if (!id_loja) return res.json({ sucesso: false, erro: "ID da loja é obrigatório" });
    statusLojas[id_loja] = {
      online: true,
      recebePedidos: ativo === true,
      ultimaAtividade: Date.now()
    };
    res.json({ sucesso: true });
  } catch (erro) {
    console.error("Erro ao atualizar status:", erro.message);
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.post(`${BASE_URL}/api/alterar-recebe-pedidos`, express.json(), (req, res) => {
  try {
    const { id_loja, recebePedidos } = req.body;
    if (!id_loja) return res.json({ sucesso: false, erro: "ID da loja obrigatório" });
    const lojas = carregarRegistroLojas();
    const indice = lojas.findIndex(l => l.id === id_loja);
    if (indice >= 0) {
      lojas[indice].recebePedidos = recebePedidos;
      salvarRegistroLojas(lojas);
      if (statusLojas[id_loja]) statusLojas[id_loja].recebePedidos = recebePedidos;
    }
    res.json({ sucesso: true });
  } catch (erro) {
    console.error("Erro ao alterar recebimento:", erro.message);
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.get(`${BASE_URL}/status`, (req, res) => {
  res.json({ online: true, sincronizando: true, versao: '1.0' });
});

app.use(`${BASE_URL}/api/arquivos`, express.static(pastaConfig, {
  index: false,
  dotfiles: 'deny'
}));

// ======================================
// 🚩 ROTAS DE ENTREGADORES
// ======================================
app.post(`${BASE_URL}/api/entregador/cadastrar`, upload.single('fotoCnh'), (req, res) => {
  try {
    const dados = req.body;
    const camposObrigatorios = ['nome', 'cpf', 'telefone', 'endereco', 'modeloVeiculo', 'anoVeiculo', 'placaVeiculo', 'cnhNumero', 'cnhCategoria', 'cnhValidade', 'login', 'senha', 'confirmaSenha'];
    for (const campo of camposObrigatorios) {
      if (!dados[campo] || dados[campo].trim() === '') {
        return res.json({ sucesso: false, erro: `Preencha o campo: ${campo}` });
      }
    }
    if (dados.senha !== dados.confirmaSenha) {
      return res.json({ sucesso: false, erro: "As senhas não coincidem" });
    }
    if (!req.file) {
      return res.json({ sucesso: false, erro: "Envie a foto da CNH" });
    }
    const pendentes = carregarPendentes();
    const aprovados = carregarEntregadores();
    const jaExiste = [...pendentes, ...aprovados].some(e =>
      e && (e.cpf === dados.cpf.trim() || e.login === dados.login.trim())
    );
    if (jaExiste) {
      return res.json({ sucesso: false, erro: "CPF ou Login já cadastrados no sistema" });
    }
    const novoCadastro = {
      id: Date.now().toString(),
      nome: dados.nome.trim(),
      cpf: dados.cpf.trim(),
      telefone: dados.telefone.trim(),
      endereco: dados.endereco.trim(),
      veiculo: {
        modelo: dados.modeloVeiculo.trim(),
        ano: dados.anoVeiculo.trim(),
        placa: dados.placaVeiculo.trim()
      },
      cnh: {
        numero: dados.cnhNumero.trim(),
        categoria: dados.cnhCategoria.trim(),
        validade: dados.cnhValidade
      },
      login: dados.login.trim(),
      senha: dados.senha.trim(),
      caminho_foto: req.file.path,
      status: "pendente",
      data_cadastro: new Date().toISOString()
    };
    pendentes.push(novoCadastro);
    salvarPendentes(pendentes);
    res.json({ sucesso: true, mensagem: "Cadastro enviado com sucesso! Aguarde a aprovação." });
  } catch (erro) {
    console.error("Erro no cadastro:", erro.message);
    res.json({ sucesso: false, erro: "Falha ao processar: " + erro.message });
  }
});

app.post(`${BASE_URL}/api/entregador/login`, (req, res) => {
  try {
    const { login, senha } = req.body;
    const entregador = carregarEntregadores().find(e => e && e.login === login && e.senha === senha && e.status === "aprovado");
    if (!entregador) return res.json({ sucesso: false, erro: "Dados inválidos ou cadastro não aprovado" });
    res.json({ sucesso: true, dados: entregador });
  } catch (erro) {
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.get(`${BASE_URL}/api/entregador/pendentes`, verificarAdmin, (req, res) => {
  try {
    const lista = carregarPendentes();
    res.json({ sucesso: true, cadastros: lista });
  } catch (erro) {
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.get(`${BASE_URL}/api/entregador/aprovados`, verificarAdmin, (req, res) => {
  try {
    const lista = carregarEntregadores();
    res.json({ sucesso: true, colaboradores: lista });
  } catch (erro) {
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.post(`${BASE_URL}/api/entregador/analisar`, verificarAdmin, (req, res) => {
  try {
    const { id, acao } = req.body;
    if (!id || !acao) return res.json({ sucesso: false, erro: "Dados incompletos" });
    const pendentes = carregarPendentes();
    const indice = pendentes.findIndex(e => e && e.id === id);
    if (indice === -1) return res.json({ sucesso: false, erro: "Cadastro não encontrado" });
    const cadastro = pendentes.splice(indice, 1)[0];
    if (acao === 'aprovar') {
      cadastro.status = "aprovado";
      cadastro.data_aprovacao = new Date().toISOString();
      const aprovados = carregarEntregadores();
      aprovados.push(cadastro);
      salvarEntregadores(aprovados);
    }
    salvarPendentes(pendentes);
    res.json({ sucesso: true, mensagem: acao === 'aprovar' ? "Cadastro aprovado com sucesso!" : "Cadastro rejeitado." });
  } catch (erro) {
    console.error("Erro ao analisar cadastro:", erro.message);
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.get(`${BASE_URL}/api/entregador/entregas-disponiveis`, async (req, res) => {
  try {
    const todasEntregas = [];
    const lojasCadastradas = carregarRegistroLojas();
    console.log(`🔍 Buscando entregas — ${lojasCadastradas.length} lojas cadastradas`);
    if (lojasCadastradas.length === 0) {
      return res.json({ sucesso: true, total: 0, entregas: [], mensagem: "Nenhuma loja cadastrada" });
    }
    for (const loja of lojasCadastradas) {
      try {
        const ipBase = (loja.ip_pdv || IP_PDV_PADRAO).split(':')[0];
        const enderecoPdv = `http://${ipBase}:5000/entregas.json`;
        console.log(`🔍 Buscando em ${loja.nome}: ${enderecoPdv}`);
        const resposta = await fetch(enderecoPdv, { timeout: 5000 });
        if (!resposta.ok) {
          console.log(`⚠️ ${loja.nome}: PDV retornou código ${resposta.status}`);
          continue;
        }
        const dadosPdv = await resposta.json();
        if (!Array.isArray(dadosPdv)) {
          console.log(`⚠️ ${loja.nome}: /entregas.json não é uma lista válida`);
          continue;
        }
        console.log(`✅ ${loja.nome}: ${dadosPdv.length} registros encontrados`);
        dadosPdv.forEach(entrega => {
          entrega.id_loja = entrega.id_loja || loja.id;
          entrega.nome_loja = entrega.nome_loja || loja.nome;
          entrega.endereco_loja = entrega.endereco_loja || loja.endereco || "Não informado";
          entrega.contato_loja = entrega.contato_loja || loja.telefone || "Não informado";
          entrega.cidade_loja = entrega.cidade_loja || loja.cidade || "Campinas";
          entrega.uf_loja = entrega.uf_loja || loja.uf || "SP";
          todasEntregas.push(entrega);
        });
      } catch (erro) {
        console.log(`❌ ${loja.nome}: não foi possível conectar — ${erro.message}`);
        continue;
      }
    }
    console.log(`🚀 Total final: ${todasEntregas.length} entregas carregadas`);
    res.json({ sucesso: true, total: todasEntregas.length, entregas: todasEntregas });
  } catch (erro) {
    console.error('❌ Erro geral na busca:', erro.message);
    res.json({ sucesso: false, erro: erro.message, entregas: [] });
  }
});

app.post(`${BASE_URL}/api/entregador/aceitar-entrega`, express.json(), async (req, res) => {
  try {
    const { id_entrega, id_loja, id_entregador, nome_entregador } = req.body;
    if (!id_entrega || !id_loja) return res.json({ sucesso: false, erro: "Informe ID da entrega e da loja" });
    const loja = carregarRegistroLojas().find(l => l.id === id_loja);
    if (!loja) return res.json({ sucesso: false, erro: "Loja não cadastrada" });
    const ipPdv = loja.ip_pdv || `http://${IP_PDV_PADRAO}`;
    console.log(`📤 Enviando aceite para: ${ipPdv}/api/aceitar-entrega`);
    console.log(`📤 Dados: id_entrega=${id_entrega}, id_entregador=${id_entregador}, status=em_andamento`);
    const resposta = await fetch(`${ipPdv}/api/aceitar-entrega`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id_entrega,
        id_entregador,
        nome_entregador,
        status: 'em_andamento'
      })
    });
    const resultado = await resposta.json();
    console.log(`✅ Resposta do PDV:`, resultado);
    if (resultado.sucesso) {
      res.json({ sucesso: true, mensagem: "Pedido aceito e sincronizado com sucesso!" });
    } else {
      res.json({ sucesso: false, erro: resultado.erro || "PDV não aceitou a requisição" });
    }
  } catch (erro) {
    console.error("❌ Erro ao aceitar entrega:", erro.message);
    res.json({ sucesso: false, erro: "Falha ao comunicar com o PDV: " + erro.message });
  }
});

app.post(`${BASE_URL}/api/entregador/finalizar-entrega`, express.json(), async (req, res) => {
  try {
    const { id_entrega, id_loja, novo_status = "entregue" } = req.body;
    if (!id_entrega || !id_loja) return res.json({ sucesso: false, erro: "Dados incompletos" });
    const loja = carregarRegistroLojas().find(l => l.id === id_loja);
    if (!loja) return res.json({ sucesso: false, erro: "Loja não cadastrada" });
    const ipPdv = loja.ip_pdv || `http://${IP_PDV_PADRAO}`;
    const resposta = await fetch(`${ipPdv}/api/atualizar-entrega`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_entrega, status: novo_status })
    });
    res.json(await resposta.json());
  } catch (erro) {
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.post(`${BASE_URL}/api/entregador/finalizar-com-foto`, uploadFotoEntrega.single('foto_comprovante'), async (req, res) => {
  try {
    const { id_entrega, id_loja, observacao = "" } = req.body;
    if (!id_entrega || !id_loja) return res.json({ sucesso: false, erro: "Dados incompletos" });
    if (!req.file) return res.json({ sucesso: false, erro: "Envie a foto de comprovação" });
    const loja = carregarRegistroLojas().find(l => l.id === id_loja);
    if (!loja) return res.json({ sucesso: false, erro: "Loja não cadastrada" });
    const ipPdv = loja.ip_pdv || `http://${IP_PDV_PADRAO}`;

    const form = new FormData();
    form.append("id_entrega", id_entrega);
    form.append("status", "entregue");
    form.append("observacao", observacao);
    form.append("foto_comprovante", fs.createReadStream(req.file.path));
    const resposta = await fetch(`${ipPdv}/api/finalizar-entrega-foto`, {
      method: "POST",
      body: form
    });
    const resultado = await resposta.json();

    fs.unlink(req.file.path, () => {});
    res.json(resultado);
  } catch (erro) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.json({ sucesso: false, erro: erro.message });
  }
});

// ======================================
// 🔄 ROTAS DE COMPATIBILIDADE
// ======================================
app.get(`${BASE_URL}/api/pedidos/disponiveis`, async (req, res) => {
  const r = await fetch(`${ENDERECO_SERVIDOR}${BASE_URL}/api/entregador/entregas-disponiveis`);
  res.json(await r.json());
});

app.post(`${BASE_URL}/api/pedidos/aceitar`, express.json(), async (req, res) => {
  const r = await fetch(`${ENDERECO_SERVIDOR}${BASE_URL}/api/entregador/aceitar-entrega`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_entrega: req.body.pedido_id,
      id_loja: req.body.loja_id,
      id_entregador: req.body.entregador_id,
      nome_entregador: req.body.nome_entregador
    })
  });
  res.json(await r.json());
});

app.post(`${BASE_URL}/api/pedidos/atualizar-status`, express.json(), async (req, res) => {
  const r = await fetch(`${ENDERECO_SERVIDOR}${BASE_URL}/api/entregador/finalizar-entrega`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_entrega: req.body.pedido_id,
      id_loja: req.body.loja_id,
      novo_status: req.body.novo_status
    })
  });
  res.json(await r.json());
});

app.get(`${BASE_URL}/api/entregas/por-loja/:idLoja`, async (req, res) => {
  try {
    const idLoja = req.params.idLoja.trim();
    const loja = carregarRegistroLojas().find(l => l.id === idLoja);
    if (!loja) return res.json({ sucesso: false, erro: "Loja não cadastrada" });
    const ipPdv = loja.ip_pdv || `http://${IP_PDV_PADRAO}`;
    const resposta = await fetch(`${ipPdv}/entregas.json`);
    const dados = await resposta.json();
    res.json({
      sucesso: true,
      id_loja: idLoja,
      nome_loja: loja.nome,
      total: Array.isArray(dados) ? dados.length : 0,
      entregas: Array.isArray(dados) ? dados : []
    });
  } catch (erro) {
    res.json({ sucesso: false, erro: erro.message });
  }
});

// ======================================
// 📋 GERENCIAMENTO DE LOJAS
// ======================================
app.get(`${BASE_URL}/api/listar-lojas`, verificarAdmin, async (req, res) => {
  try {
    const lojasRegistro = carregarRegistroLojas();
    const listaFinal = [];
    for (const loja of lojasRegistro) {
      const ipPdv = loja.ip_pdv || `http://${IP_PDV_PADRAO}`;
      let statusPdv = { online: false, aberto: false, sincronizado: false, liberar_vitrine: false };
      try {
        const resposta = await fetch(`${ipPdv}/api/ping-por-id/${loja.id}`, { timeout: 2500 });
        if (resposta.ok) {
          const dados = await resposta.json();
          statusPdv = {
            online: true,
            aberto: dados.aberto === true,
            sincronizado: dados.sincronizado === true,
            liberar_vitrine: dados.liberar_vitrine === true
          };
        }
      } catch {}
      const podeLiberar =
        loja.status_sistema === "ATIVO"
        && loja.recebePedidos === true
        && statusPdv.online
        && statusPdv.aberto
        && statusPdv.sincronizado;
      listaFinal.push({
        ...loja,
        pdv_online: statusPdv.online,
        pdv_aberto: statusPdv.aberto,
        pdv_sincronizado: statusPdv.sincronizado,
        status_led: podeLiberar ? "verde" : "vermelho",
        liberar_vitrine: podeLiberar,
        link_vitrine: podeLiberar ? `${LINK_VITRINE_PUBLICO}/vitrine/${loja.id}` : "#"
      });
    }
    res.json({ sucesso: true, total: listaFinal.length, lojas: listaFinal });
  } catch (erro) {
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.post(`${BASE_URL}/api/cadastrar-loja`, verificarAdmin, (req, res) => {
  try {
    const { documento, nome, endereco, pix } = req.body;
    if (!documento || !nome || !endereco || !pix?.chave) {
      return res.json({ sucesso: false, erro: "Preencha todos os campos obrigatórios" });
    }
    const idLoja = documento.replace(/\D/g, '');
    const lojas = carregarRegistroLojas();
    if (lojas.some(l => l.id === idLoja)) {
      return res.json({ sucesso: false, erro: "CNPJ já cadastrado" });
    }
    const novaLoja = {
      id: idLoja,
      documento: documento,
      nome: nome.trim(),
      endereco: endereco.trim(),
      cidade: "Campinas",
      ip_pdv: `http://${IP_PDV_PADRAO}`,
      pix: { chave: pix.chave.trim(), tipo: pix.tipo || "outra", titular: pix.titular || nome, cidade: pix.cidade || "Campinas" },
      data_cadastro: new Date().toISOString().split('T')[0],
      codigo_final: null,
      pronta_para_exe: false,
      plano: "GRATUITO",
      percentual_comissao: 5,
      status_sistema: "ATIVO",
      recebePedidos: true,
            valor_devido: 0,
      ultimo_acerto: null
    };
    const camLoja = path.join(pastaLojas, idLoja);
    const camEstoque = path.join(camLoja, 'estoque');
    const camVendas = path.join(camLoja, 'vendas');
    const camPedidos = path.join(camLoja, 'pedidos_pendentes');
    [camLoja, camEstoque, camVendas, camPedidos].forEach(p => { 
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }) 
    });
    fs.writeFileSync(path.join(camLoja, 'dados_loja.json'), JSON.stringify(novaLoja, null, 2), 'utf8');
    fs.writeFileSync(path.join(camEstoque, 'produtos.json'), JSON.stringify({ nomeLoja: nome, produtos: [] }, null, 2), 'utf8');
    lojas.push(novaLoja);
    salvarRegistroLojas(lojas);
    res.json({ sucesso: true, mensagem: "✅ Loja cadastrada com sucesso!" });
  } catch (erro) {
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.post(`${BASE_URL}/api/gerar-estrutura-loja`, verificarAdmin, (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ sucesso: false, erro: "ID da loja não informado" });
    const lojas = carregarRegistroLojas();
    const indice = lojas.findIndex(l => l.id === id);
    if (indice === -1) return res.json({ sucesso: false, erro: "Loja não cadastrada" });
    const loja = lojas[indice];
    loja.codigo_final = loja.codigo_final || `ACI-${id}-${Date.now().toString().slice(-6)}`;
    loja.pronta_para_exe = true;
    loja.ultima_atualizacao = new Date().toISOString();
    const camLoja = path.join(pastaLojas, id);
    const camEstoque = path.join(camLoja, 'estoque');
    const camVendas = path.join(camLoja, 'vendas');
    const camPedidos = path.join(camLoja, 'pedidos_pendentes');
    [camLoja, camEstoque, camVendas, camPedidos].forEach(p => { 
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }) 
    });
    fs.writeFileSync(path.join(camLoja, 'dados_loja.json'), JSON.stringify(loja, null, 2), 'utf8');
    salvarRegistroLojas(lojas);
    res.json({
      sucesso: true,
      mensagem: "✅ Estrutura gerada com sucesso!",
      codigo: `const ID_LOJA = "${id}";\nconst NOME_LOJA = "${loja.nome}";\nconst SERVIDOR = "${ENDERECO_SERVIDOR}";`
    });
  } catch (erro) {
    console.error("❌ Erro ao gerar estrutura:", erro.message);
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.post(`${BASE_URL}/api/salvar-item`, verificarAdmin, (req, res) => {
  try {
    const { id_loja, codigo, nome, preco, quantidade, unidade } = req.body;
    if (!id_loja || !codigo || !nome || !preco) {
      return res.json({ sucesso: false, erro: "Dados incompletos" });
    }
    const camEstoque = path.join(pastaLojas, id_loja, 'estoque', 'produtos.json');
    let estoque = fs.existsSync(camEstoque) ? JSON.parse(fs.readFileSync(camEstoque, 'utf8')) : { produtos: [] };
    const indice = estoque.produtos.findIndex(p => p.codigo === codigo);
    const produto = {
      codigo,
      nome: nome.toUpperCase().trim(),
      preco: Number(preco),
      quantidade: Number(quantidade || 0),
      unidade: unidade || "UN"
    };
    indice >= 0 ? estoque.produtos[indice] = produto : estoque.produtos.push(produto);
    salvarDadosSeguro(camEstoque, estoque);
    res.json({ sucesso: true });
  } catch (erro) {
    console.error("❌ Erro ao salvar item:", erro.message);
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.get(`${BASE_URL}/api/obter-estoque/:idLoja`, (req, res) => {
  try {
    const camEstoque = path.join(pastaLojas, req.params.idLoja, 'estoque', 'produtos.json');
    const produtos = fs.existsSync(camEstoque) ? JSON.parse(fs.readFileSync(camEstoque, 'utf8')).produtos : [];
    res.json({ sucesso: true, produtos });
  } catch {
    res.json({ sucesso: true, produtos: [] });
  }
});

app.post(`${BASE_URL}/api/registrar-venda`, express.json(), (req, res) => {
  try {
    const { idLoja, id_entregador, nome_entregador, total, taxa_entrega = 0, origem = "PDV", itens } = req.body;
    if (!idLoja || !total) {
      return res.json({ sucesso: false, erro: "Dados inválidos" });
    }
    const lojas = carregarRegistroLojas();
    if (origem !== "ONLINE") {
      if (!itens || itens.length === 0) return res.json({ sucesso: false, erro: "Itens obrigatórios para venda local" });
      const camEstoque = path.join(pastaLojas, idLoja, 'estoque', 'produtos.json');
      const estoque = JSON.parse(fs.readFileSync(camEstoque, 'utf8'));
      let temErroEstoque = false;
      itens.forEach(item => {
        const indice = estoque.produtos.findIndex(p => p.codigo === item.codigo);
        if (indice === -1) {
          temErroEstoque = true;
          return;
        }
        estoque.produtos[indice].quantidade = Math.max(0, estoque.produtos[indice].quantidade - Number(item.quantidade));
      });
      if (temErroEstoque) {
        return res.json({ sucesso: false, erro: "Um ou mais produtos não encontrados no estoque" });
      }
      salvarDadosSeguro(camEstoque, estoque);
    }
    const idVenda = Date.now().toString();
    const dadosVenda = {
      id: idVenda,
      id_loja: idLoja,
      id_entregador: id_entregador || null,
      nome_entregador: nome_entregador || null,
      valor_total: Number(total),
      taxa_entrega: Number(taxa_entrega),
      origem: origem,
      itens: itens || [],
      data_hora: new Date().toISOString(),
      ja_fechado: false
    };
    const camVenda = path.join(pastaLojas, idLoja, 'vendas', `${idVenda}.json`);
    salvarDadosSeguro(camVenda, dadosVenda);
    res.json({ sucesso: true, id_venda: idVenda, mensagem: "Venda registrada com sucesso!" });
  } catch (erro) {
    console.error("❌ Erro ao registrar venda:", erro.message);
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.get(`${BASE_URL}/api/listar-vendas/:idLoja`, verificarAdmin, (req, res) => {
  try {
    const idLoja = req.params.idLoja.trim();
    const camVendas = path.join(pastaLojas, idLoja, 'vendas');
    if (!fs.existsSync(camVendas)) return res.json({ sucesso: true, vendas: [] });
    const arquivos = fs.readdirSync(camVendas).filter(a => a.endsWith('.json'));
    const vendas = arquivos.map(arq => {
      try { return JSON.parse(fs.readFileSync(path.join(camVendas, arq), 'utf8')) }
      catch { return null }
    }).filter(v => v !== null);
    res.json({ sucesso: true, total: vendas.length, vendas });
  } catch (erro) {
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.get(`${BASE_URL}/api/acerto-semanal`, verificarAdmin, (req, res) => {
  try {
    const { dataInicio, dataFim } = req.query;
    const inicio = dataInicio ? new Date(dataInicio) : null;
    const fim = dataFim ? new Date(dataFim) : null;
    const resultado = calcularAcertoSemanal(inicio, fim);
    res.json(resultado);
  } catch (erro) {
    res.json({ erro: erro.message });
  }
});

app.post(`${BASE_URL}/api/registrar-acerto/:idLoja`, verificarAdmin, (req, res) => {
  try {
    const idLoja = req.params.idLoja.trim();
    const lojas = carregarRegistroLojas();
    const indice = lojas.findIndex(l => l.id === idLoja);
    if (indice === -1) return res.json({ sucesso: false, erro: "Loja não encontrada" });
    lojas[indice].ultimo_acerto = new Date().toISOString();
    lojas[indice].valor_devido = 0;
    lojas[indice].status_sistema = "ATIVO";
    lojas[indice].aviso_enviado = false;
    salvarRegistroLojas(lojas);
    const camDadosLoja = path.join(pastaLojas, idLoja, 'dados_loja.json');
    if (fs.existsSync(camDadosLoja)) salvarDadosSeguro(camDadosLoja, lojas[indice]);
    fazerBackup();
    res.json({ sucesso: true, mensagem: "Acerto registrado e sistema liberado!" });
  } catch (erro) {
    res.json({ sucesso: false, erro: erro.message });
  }
});

app.get(`${BASE_URL}/api/relatorios/geral`, verificarAdmin, (req, res) => {
  try {
    const lojas = carregarRegistroLojas();
    const resumo = lojas.map(loja => {
      const valores = calcularValoresDevidos(loja.id);
      return {
        id: loja.id,
        nome: loja.nome,
        status: loja.status_sistema,
        total_vendas: valores.total_vendas,
        comissao_devida: valores.comissao,
        taxa_entregadores: valores.taxa_entregadores,
        total_devido: valores.total_devido,
        ultimo_acerto: loja.ultimo_acerto || "Nunca"
      };
    });
    const totalGeral = resumo.reduce((s, l) => s + l.total_devido, 0);
    res.json({ sucesso: true, total_geral_devido: totalGeral, lojas: resumo });
  } catch (erro) {
    res.json({ sucesso: false, erro: erro.message });
  }
});

// ======================================
// 🚨 PÁGINA NÃO ENCONTRADA E TRATAMENTO DE ERROS
// ======================================
app.use((req, res) => {
  res.status(404).send(`<h2 style="color:red; text-align:center; margin-top:3rem;">❌ Página não encontrada</h2>`);
});

app.use((erro, req, res, next) => {
  console.error("⚠️ Erro no servidor:", erro.message);
  res.status(500).json({ sucesso: false, erro: "Erro interno no servidor" });
});

// ======================================
// 🚀 INICIAR SERVIDOR
// ======================================
app.listen(PORTA, () => {
  console.log(`\n🚀 SERVIDOR INICIADO COM SUCESSO!`);
  console.log(`📍 Endereço: ${ENDERECO_SERVIDOR}`);
  console.log(`📂 Pasta raiz: ${pastaRaiz}`);
  console.log(`⏱️ Verificação de vencimentos automática ativada`);
  console.log(`📦 Ambiente: ${AMBIENTE}`);
  if (AMBIENTE === 'development') {
    console.log(`🔗 Local: http://localhost:${PORTA}`);
  }
  fazerBackup();
});