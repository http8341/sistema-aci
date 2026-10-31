from flask import Flask, render_template, request, jsonify, send_from_directory
import json
import os
import requests
from datetime import datetime
from flask_cors import CORS
from werkzeug.utils import secure_filename
import unicodedata
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__,
            template_folder=os.path.join(BASE_DIR, "templates"),
            static_folder=os.path.join(BASE_DIR, "static"))

CORS(app, origins=["*"])

# ✅ CAMINHOS DEFINIDOS — CRIA PASTAS SOMENTE SE NÃO EXISTIR, SEM DUPLICAÇÃO
UPLOAD_FOLDER = os.path.join(BASE_DIR, "comprovantes")
PASTA_RELATORIOS_ADMIN = os.path.join(BASE_DIR, "relatorios_admin")

# Cria as pastas apenas uma vez, se não existirem
for pasta in [UPLOAD_FOLDER, PASTA_RELATORIOS_ADMIN]:
    if not os.path.exists(pasta):
        os.makedirs(pasta)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}

ESTOQUE_FILE        = os.path.join(BASE_DIR, "mercearia.json")
VENDAS_FILE         = os.path.join(BASE_DIR, "vendas.json")
PEDIDOS_FILE        = os.path.join(BASE_DIR, "pedidos.json")
ENTREGAS_FILE       = os.path.join(BASE_DIR, "entregas.json")
CONFIG_LOJA_FILE    = os.path.join(BASE_DIR, "config-loja.json")
CONFIG_NOTA_FILE    = os.path.join(BASE_DIR, "config_nota.json")

# ======================================
# 📍 DADOS FIXOS DESTA LOJA — ALTERE SOMENTE AQUI PARA CADA LOJA
# ======================================
ID_LOJA_ATUAL       = "41177958000130"
NOME_LOJA_ATUAL     = "Mercearia Do Mineiro"
ENDERECO_LOJA       = "Rua Antonio Rodrigues De Almeida 695, Jd Itaguaçú"
CIDADE_LOJA         = "Campinas"
UF_LOJA             = "SP"
CONTATO_LOJA        = "19-99837-0620"
TIPO_ID             = "CNPJ 41.177.958/0001-30"

# ✅ CONTROLE DE STATUS — VOCÊ ALTERA AQUI PARA LIBERAR/BLOQUEAR
SINCRONIZAR         = True   # ✅ = RECEBE PEDIDOS / LIBERA VITRINE
PING_OK             = True   # ✅ = CONECTADO
LOJA_ABERTA         = True   # ✅ = LOJA ABERTA
MODO_COM_NOTA       = False
ULTIMO_NUMERO_NOTA  = 0
SERVIDOR_PRINCIPAL  = "http://192.168.15.82:3000"
TAXA_ENTREGA_PADRAO = 10.00
IP_ATUAL            = "192.168.15.82:5000"
LINK_VITRINE_PUBLICO = "http://192.168.15.82:5000" # ✅ APONTA PARA O PDV DA LOJA

CAMINHO_REGISTRO_LOJAS = os.path.join(BASE_DIR, "..", "config", "registro_lojas.json")
CAMINHO_ENTREGADORES = os.path.join(BASE_DIR, "..", "config", "entregadores.json")

# ======================================
# 🛠️ FUNÇÕES AUXILIARES — NÃO ALTERAR
# ======================================
def carregar_dados(arquivo, valor_padrao):
    pasta_arquivo = os.path.dirname(arquivo)
    if pasta_arquivo and not os.path.exists(pasta_arquivo):
        os.makedirs(pasta_arquivo, exist_ok=True)
    
    if not os.path.exists(arquivo):
        try:
            with open(arquivo, "w", encoding="utf-8") as f:
                json.dump(valor_padrao, f, indent=4, ensure_ascii=False)
        except:
            pass
        return valor_padrao
    try:
        with open(arquivo, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return valor_padrao

def salvar_dados(arquivo, dados):
    try:
        with open(arquivo, "w", encoding="utf-8") as f:
            json.dump(dados, f, indent=4, ensure_ascii=False)
        return True
    except:
        return False

def verificar_conexao_real():
    try:
        requests.get("https://1.1.1.1", timeout=1)
        return True
    except:
        return False

def normalizar_texto(texto):
    texto = unicodedata.normalize('NFKD', str(texto))
    texto = texto.encode('ASCII', 'ignore').decode('ASCII')
    texto = re.sub(r"[^a-zA-Z0-9\s]", "", texto)
    return texto.lower().strip().replace(" ", "_")

def salvar_configuracoes():
    dados = {
        "nome_loja": NOME_LOJA_ATUAL,
        "tipo_id": TIPO_ID,
        "id_loja": ID_LOJA_ATUAL,
        "servidor_principal": SERVIDOR_PRINCIPAL,
        "recebe_pedidos": SINCRONIZAR,
        "loja_aberta": LOJA_ABERTA,
        "modo_com_nota": MODO_COM_NOTA
    }
    salvar_dados(CONFIG_LOJA_FILE, dados)

def carregar_configuracoes():
    global NOME_LOJA_ATUAL, TIPO_ID, ID_LOJA_ATUAL, SERVIDOR_PRINCIPAL, SINCRONIZAR, LOJA_ABERTA, MODO_COM_NOTA
    cfg = carregar_dados(CONFIG_LOJA_FILE, {})
    if not ID_LOJA_ATUAL:
        ID_LOJA_ATUAL = cfg.get("id_loja", ID_LOJA_ATUAL)
        NOME_LOJA_ATUAL = cfg.get("nome_loja", NOME_LOJA_ATUAL)
        TIPO_ID = cfg.get("tipo_id", TIPO_ID)
    SERVIDOR_PRINCIPAL = cfg.get("servidor_principal", SERVIDOR_PRINCIPAL)
    SINCRONIZAR = cfg.get("recebe_pedidos", True)
    LOJA_ABERTA = cfg.get("loja_aberta", True)
    MODO_COM_NOTA = cfg.get("modo_com_nota", MODO_COM_NOTA)

# ======================================
# 🛠️ CARREGAMENTO DOS DADOS DA LOJA — NÃO ALTERAR
# ======================================
def carregar_dados_loja_cadastro():
    try:
        cfg_local = carregar_dados(CONFIG_LOJA_FILE, {})
        id_loja_local = cfg_local.get("id_loja", ID_LOJA_ATUAL)
        
        if not os.path.exists(CAMINHO_REGISTRO_LOJAS):
            print("⚠️ Sem registro_lojas.json, usando dados locais fixos")
            return {
                "id": ID_LOJA_ATUAL,
                "nome": NOME_LOJA_ATUAL,
                "endereco": ENDERECO_LOJA,
                "cidade": CIDADE_LOJA,
                "uf": UF_LOJA,
                "contato": CONTATO_LOJA
            }
        
        with open(CAMINHO_REGISTRO_LOJAS, "r", encoding="utf-8") as f:
            registro = json.load(f)
        
        loja = next((l for l in registro.get("lojas", []) if str(l.get("id")) == str(id_loja_local)), None)
        if loja:
            print(f"✅ Dados carregados do Admin: {loja.get('nome')}")
            return {
                "id": loja.get("id", ID_LOJA_ATUAL),
                "nome": loja.get("nome", NOME_LOJA_ATUAL),
                "endereco": loja.get("endereco", ENDERECO_LOJA),
                "cidade": loja.get("cidade", CIDADE_LOJA),
                "uf": loja.get("uf", UF_LOJA),
                "contato": loja.get("contato", CONTATO_LOJA)
            }
        
        print(f"⚠️ Loja {id_loja_local} não encontrada no cadastro, usando dados fixos")
        return {
            "id": ID_LOJA_ATUAL,
            "nome": NOME_LOJA_ATUAL,
            "endereco": ENDERECO_LOJA,
            "cidade": CIDADE_LOJA,
            "uf": UF_LOJA,
            "contato": CONTATO_LOJA
        }
    except Exception as e:
        print(f"⚠️ Erro no cadastro: {str(e)} | Usando dados fixos")
        return {
            "id": ID_LOJA_ATUAL,
            "nome": NOME_LOJA_ATUAL,
            "endereco": ENDERECO_LOJA,
            "cidade": CIDADE_LOJA,
            "uf": UF_LOJA,
            "contato": CONTATO_LOJA
        }

dados_loja_completos = carregar_dados_loja_cadastro()

# ======================================
# 🚫 VALIDAÇÃO DE ENTREGADOR — CORRIGIDA E DINÂMICA
# ======================================
@app.route("/api/validar-entregador", methods=["POST"])
@app.route("/api/entregador/login", methods=["POST"])
def validar_entregador():
    try:
        dados = request.get_json()
        login = dados.get("login", "").strip().upper()
        senha = dados.get("senha", "").strip()

        if not os.path.exists(CAMINHO_ENTREGADORES):
            return jsonify({"sucesso": False, "erro": "Sistema de entregadores indisponível"})

        with open(CAMINHO_ENTREGADORES, "r", encoding="utf-8") as f:
            lista_entregadores = json.load(f)

        entregador = next((e for e in lista_entregadores 
                          if str(e.get("login", "")).strip().upper() == login 
                          and str(e.get("senha", "")) == senha 
                          and str(e.get("status", "")) == "aprovado"), None)

        if not entregador:
            return jsonify({"sucesso": False, "erro": "Credenciais inválidas ou cadastro não aprovado"})

        return jsonify({
            "sucesso": True,
            "dados": {
                "cpf": str(entregador.get("cpf", "")).strip(),
                "nome": entregador.get("nome", "Entregador")
            }
        })
    except Exception as e:
        print(f"❌ Erro na validação: {str(e)}")
        return jsonify({"sucesso": False, "erro": "Erro no sistema"})

# ======================================
# 🚀 ROTAS DE STATUS — AJUSTADAS PARA USAR CONFIGURAÇÕES DA LOJA
# ======================================
@app.route("/api/ping-por-id/<idLoja>", methods=["GET"])
def ping_por_id(idLoja):
    """Retorna status REAL controlado por essa loja — define bolinha verde/vermelha"""
    status_led = "verde" if (SINCRONIZAR and PING_OK and LOJA_ABERTA) else "vermelho"
    status_texto = "✅ Loja online e vitrine liberada" if status_led == "verde" else "❌ Loja offline ou bloqueada"
    
    return jsonify({
        "status_led": status_led,
        "status_texto": status_texto,
        "aberto": LOJA_ABERTA,
        "sincronizado": PING_OK,
        "liberar_vitrine": SINCRONIZAR,
        "recebe_pedidos": SINCRONIZAR,
        "id_loja": ID_LOJA_ATUAL
    })

@app.route("/api/status-loja", methods=["GET"])
def status_loja():
    """Rota padrão para consulta de status"""
    status_led = "verde" if (SINCRONIZAR and PING_OK and LOJA_ABERTA) else "vermelho"
    return jsonify({
        "id_loja": ID_LOJA_ATUAL,
        "nome_loja": NOME_LOJA_ATUAL,
        "recebe_pedidos": SINCRONIZAR,
        "loja_aberta": LOJA_ABERTA,
        "status": "ATIVO" if status_led == "verde" else "INATIVO",
        "status_led": status_led,
        "liberar_vitrine": SINCRONIZAR,
        "link_vitrine": f"{LINK_VITRINE_PUBLICO}/vitrine/{ID_LOJA_ATUAL}"
    })

@app.route("/")
def index():
    return render_template("pdv-loja.html")

@app.route("/aci-entregador.html")
def aci_entregador():
    return send_from_directory(BASE_DIR, "aci-entregador.html")

# ======================================
# 🛒 ROTAS DA VITRINE — AJUSTADAS PARA USAR DADOS FIXOS DA LOJA
# ======================================
@app.route("/vitrine")
@app.route("/vitrine/")
@app.route("/vitrine/<identificador>")
def vitrine(identificador=None):
    """Carrega vitrine com os dados fixos dessa loja, ignora o que vier na URL"""
    return render_template("vitrine.html", 
                          nome_loja=NOME_LOJA_ATUAL, 
                          id_loja=ID_LOJA_ATUAL,
                          cnpj=TIPO_ID.split(" ")[1])

@app.route("/get_estoque", methods=["GET"])
def get_estoque():
    return jsonify(carregar_dados(ESTOQUE_FILE, []))

@app.route("/api/obter-estoque", methods=["GET"])
def api_obter_estoque():
    return jsonify({"sucesso": True, "produtos": carregar_dados(ESTOQUE_FILE, [])})

@app.route("/salvar_item", methods=["POST"])
def salvar_item():
    try:
        novo_item = request.get_json()
        if not novo_item or "cod" not in novo_item or "nome" not in novo_item or "preco" not in novo_item:
            return jsonify({"status": "erro", "mensagem": "Dados incompletos"}), 400
        novo_item["nome"] = str(novo_item["nome"]).upper().strip()
        novo_item["preco"] = float(novo_item["preco"])
        novo_item["qtd"] = float(novo_item.get("qtd", 0))
        novo_item["unidade"] = str(novo_item.get("unidade", "UN")).upper().strip() or "UN"
        estoque = carregar_dados(ESTOQUE_FILE, [])
        idx = next((i for i, item in enumerate(estoque) if item["cod"] == novo_item["cod"]), None)
        if idx is not None:
            estoque[idx] = novo_item
        else:
            estoque.append(novo_item)
        salvar_dados(ESTOQUE_FILE, estoque)
        return jsonify({"status": "sucesso", "mensagem": "Item salvo"})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)}), 500

@app.route("/api/atualizar-estoque", methods=["POST"])
def api_atualizar_estoque():
    try:
        dados = request.get_json()
        if not dados or "estoque" not in dados:
            return jsonify({"sucesso": False, "mensagem": "Dados inválidos"}), 400
        salvar_dados(ESTOQUE_FILE, dados["estoque"])
        return jsonify({"sucesso": True, "mensagem": "Estoque atualizado!"})
    except Exception as e:
        return jsonify({"sucesso": False, "erro": str(e)}), 500

@app.route("/registrar_venda", methods=["POST"])
def registrar_venda():
    try:
        dados_venda = request.get_json()
        itens_venda = dados_venda.get("itens") or dados_venda.get("produtos") or dados_venda.get("lista_itens")
        total_venda = dados_venda.get("total") or dados_venda.get("valor_total") or dados_venda.get("total_geral")
        subtotal = dados_venda.get("subtotal") or dados_venda.get("subtotal_produtos", total_venda)
        taxa_entrega = dados_venda.get("taxa_entrega", 0)
        com_nota = dados_venda.get("com_nota", MODO_COM_NOTA)
        if not itens_venda or not total_venda:
            return jsonify({"status": "erro", "mensagem": "Itens ou total faltando"}), 400
        vendas = carregar_dados(VENDAS_FILE, [])
        estoque = carregar_dados(ESTOQUE_FILE, [])
        itens_tratados = []
        for item in itens_venda:
            cod = item.get("cod") or item.get("codigo") or item.get("id_produto")
            qtd = float(item.get("qtd") or item.get("quantidade") or item.get("quant", 0))
            unidade = str(item.get("unidade") or item.get("medida") or "UN").strip() or "UN"
            preco = round(float(item.get("preco") or item.get("valor_unitario") or 0), 2)
            nome = str(item.get("nome") or item.get("descricao") or "PRODUTO").strip().upper()
            if cod and qtd > 0:
                for p in estoque:
                    if p["cod"] == cod:
                        p["qtd"] = round(max(0, p["qtd"] - qtd), 2)
            itens_tratados.append({"cod": cod, "nome": nome, "preco": preco, "qtd": qtd, "unidade": unidade})
        venda = {
            "data_hora": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "itens": itens_tratados,
            "id_loja": ID_LOJA_ATUAL,
            "tipo": dados_venda.get("tipo", "LOCAL"),
            "subtotal": round(float(subtotal), 2),
            "taxa_entrega": round(float(taxa_entrega), 2),
            "pagamento": dados_venda.get("pagamento", "DINHEIRO"),
            "forma_pagamento": dados_venda.get("forma_pagamento", "DINHEIRO"),
            "status_caixa": "FINALIZADO",
            "com_nota_fiscal": bool(com_nota),
            "observacao": "Venda sem Nota Fiscal" if not com_nota else "Venda com Nota Fiscal"
        }
        vendas.append(venda)
        salvar_dados(VENDAS_FILE, vendas)
        salvar_dados(ESTOQUE_FILE, estoque)
        return jsonify({"status": "sucesso", "mensagem": "Venda registrada"})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": f"Erro: {str(e)}"}), 500

@app.route("/status", methods=["GET"])
def status():
    status_led = "verde" if (SINCRONIZAR and PING_OK and LOJA_ABERTA) else "vermelho"
    return jsonify({
        "ok": True,
        "servidor": "ativo",
        "versao": "2.0",
        "sincronizando": SINCRONIZAR,
        "conectado": verificar_conexao_real(),
        "loja_aberta": LOJA_ABERTA,
        "id_loja": ID_LOJA_ATUAL,
        "nome_loja": NOME_LOJA_ATUAL,
        "status": "ATIVO" if status_led == "verde" else "INATIVO",
        "status_led": status_led,
            "liberar_vitrine": SINCRONIZAR,
            "link_vitrine": f"{LINK_VITRINE_PUBLICO}/vitrine/{ID_LOJA_ATUAL}"
    })

@app.route("/api/loja/atualizar-status", methods=["POST", "GET"])
def api_loja_atualizar_status():
    status_led = "verde" if (SINCRONIZAR and PING_OK and LOJA_ABERTA) else "vermelho"
    return jsonify({
        "sucesso": True,
        "id_loja": ID_LOJA_ATUAL,
        "cnpj": TIPO_ID.split(" ")[1],
        "nome_loja": NOME_LOJA_ATUAL,
        "status": "ATIVO" if status_led == "verde" else "INATIVO",
        "recebe_pedidos": SINCRONIZAR,
        "loja_aberta": LOJA_ABERTA,
        "status_led": status_led,
        "liberar_vitrine": SINCRONIZAR,
        "link_vitrine": f"{LINK_VITRINE_PUBLICO}/vitrine/{ID_LOJA_ATUAL}",
        "endereco": dados_loja_completos["endereco"],
        "endereco_ip": IP_ATUAL,
        "ultimo_ping": datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    })

@app.route("/api/alterar-recebe-pedidos", methods=["POST"])
def alterar_recebe_pedidos():
    global SINCRONIZAR
    dados = request.get_json()
    SINCRONIZAR = dados.get("recebePedidos", True)
    salvar_configuracoes()
    status_led = "verde" if (SINCRONIZAR and PING_OK and LOJA_ABERTA) else "vermelho"
    return jsonify({
        "sucesso": True,
        "recebePedidos": SINCRONIZAR,
        "status_led": status_led,
        "liberar_vitrine": SINCRONIZAR,
        "link_vitrine": f"{LINK_VITRINE_PUBLICO}/vitrine/{ID_LOJA_ATUAL}"
    })

@app.route("/api/status-publico/<identificador>", methods=["GET"])
def status_publico(identificador):
    if normalizar_texto(identificador) not in [normalizar_texto(ID_LOJA_ATUAL), normalizar_texto(NOME_LOJA_ATUAL)]:
        return jsonify({"erro": "Loja não encontrada"}), 404
    status_led = "verde" if (SINCRONIZAR and PING_OK and LOJA_ABERTA) else "vermelho"
    return jsonify({
        "id_loja": ID_LOJA_ATUAL,
        "nome_loja": NOME_LOJA_ATUAL,
        "status": "ATIVO" if status_led == "verde" else "INATIVO",
        "status_led": status_led,
        "liberar_vitrine": SINCRONIZAR,
        "link_vitrine": f"{LINK_VITRINE_PUBLICO}/vitrine/{ID_LOJA_ATUAL}"
    })

@app.route("/api/ping-por-nome/<nome_loja>", methods=["GET"])
def ping_por_nome(nome_loja):
    if normalizar_texto(nome_loja) != normalizar_texto(NOME_LOJA_ATUAL):
        return jsonify({
            "nome_original": NOME_LOJA_ATUAL,
            "id_loja": ID_LOJA_ATUAL,
            "endereco": dados_loja_completos["endereco"],
            "status_led": "vermelho",
            "status_texto": "Loja não corresponde",
            "liberar_vitrine": False,
            "link_vitrine": "#"
        }), 200
    status_led = "verde" if (SINCRONIZAR and PING_OK and LOJA_ABERTA) else "vermelho"
    return jsonify({
        "nome_original": NOME_LOJA_ATUAL,
        "id_loja": ID_LOJA_ATUAL,
        "endereco": dados_loja_completos["endereco"],
        "status_led": status_led,
        "status_texto": "Aberto e sincronizado",
        "liberar_vitrine": SINCRONIZAR,
        "link_vitrine": f"{LINK_VITRINE_PUBLICO}/vitrine/{ID_LOJA_ATUAL}"
    }), 200

def arquivo_permitido(nome):
    return '.' in nome and nome.rsplit('.',1)[1].lower() in ALLOWED_EXTENSIONS

@app.route("/receber_pedido", methods=["POST"])
def receber_pedido():
    try:
        dados_form = request.form
        arquivo = request.files.get("comprovante")
        nome_cliente = dados_form.get("nome") or dados_form.get("nome_cliente") or dados_form.get("cliente")
        endereco = dados_form.get("endereco") or dados_form.get("endereco_entrega") or dados_form.get("endereco_completo")
        telefone = dados_form.get("telefone") or dados_form.get("contato") or dados_form.get("celular")
        itens_texto = dados_form.get("itens") or dados_form.get("lista_itens")
        total_geral = dados_form.get("total_geral") or dados_form.get("total") or dados_form.get("valor_total")
        subtotal_produtos = dados_form.get("subtotal_produtos") or dados_form.get("subtotal") or dados_form.get("valor_produtos", 0)
        taxa_entrega = dados_form.get("taxa_entrega") or dados_form.get("entrega") or dados_form.get("frete", TAXA_ENTREGA_PADRAO)
        if not all([nome_cliente, endereco, telefone, itens_texto, total_geral, arquivo]):
            return jsonify({"sucesso": False, "mensagem": "Preencha todos os campos"}), 400
        itens = []
        for item in json.loads(itens_texto):
            itens.append({
                "cod": item.get("cod") or item.get("codigo") or item.get("id_produto"),
                "nome": str(item.get("nome") or item.get("descricao") or "PRODUTO").strip().upper(),
                "preco": round(float(item.get("preco") or item.get("valor_unitario") or 0), 2),
                "qtd": round(float(item.get("qtd") or item.get("quantidade") or 0), 2),
                "unidade": str(item.get("unidade") or item.get("medida") or "UN").strip() or "UN"
            })
        if not arquivo_permitido(arquivo.filename):
            return jsonify({"sucesso": False, "mensagem": "Envie apenas PNG/JPG/WEBP"}), 400
        id_pedido = datetime.now().strftime("%Y%m%d%H%M%S")
        nome_seguro = secure_filename(f"pedido_{id_pedido}_{arquivo.filename}")
        caminho_completo = os.path.join(UPLOAD_FOLDER, nome_seguro)
        arquivo.save(caminho_completo)
        pedido = {
            "id": id_pedido,
            "id_loja": ID_LOJA_ATUAL,
            "nome_cliente": nome_cliente,
            "endereco_entrega": endereco,
            "contato": telefone,
            "itens": itens,
            "subtotal_produtos": round(float(subtotal_produtos), 2),
            "taxa_entrega": round(float(taxa_entrega), 2),
            "total_geral": round(float(total_geral), 2),
            "codigo_pix": dados_form.get("codigo_pix", "") or dados_form.get("pix", ""),
            "comprovante_url": f"/comprovantes/{nome_seguro}",
            "status": "aguardando_confirmacao",
            "data_recebido": datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        }
        pedidos = carregar_dados(PEDIDOS_FILE, [])
        pedidos.append(pedido)
        salvar_dados(PEDIDOS_FILE, pedidos)
        return jsonify({"sucesso": True, "id_pedido": id_pedido, "mensagem": "Pedido recebido!"}), 200
    except Exception as e:
        return jsonify({"sucesso": False, "mensagem": f"Erro: {str(e)}"}), 500

@app.route("/api/aprovar-pedido", methods=["POST"])
def aprovar_pedido():
    try:
        dados = request.get_json()
        id_pedido = dados.get("id_pedido")
        if not id_pedido:
            return jsonify({"sucesso": False, "mensagem": "ID do pedido obrigatório"}), 400
        pedidos = carregar_dados(PEDIDOS_FILE, [])
        pedido = next((p for p in pedidos if p["id"] == id_pedido), None)
        if not pedido:
            return jsonify({"sucesso": False, "mensagem": "Pedido não encontrado"}), 404
        pedido["status"] = "aprovado_aguardando_entrega"
        pedido["data_aprovacao"] = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        salvar_dados(PEDIDOS_FILE, pedidos)

        entregas = carregar_dados(ENTREGAS_FILE, [])
        entregas.append({
            "id_entrega": f"ENT-{id_pedido}",
            "id_pedido": id_pedido,
            "id_loja": dados_loja_completos["id"],
            "nome_loja": dados_loja_completos["nome"],
            "endereco_loja": dados_loja_completos["endereco"],
            "cidade_loja": dados_loja_completos["cidade"],
            "uf_loja": dados_loja_completos["uf"],
            "contato_loja": dados_loja_completos.get("contato", CONTATO_LOJA),
            "cliente": pedido["nome_cliente"],
            "endereco": pedido["endereco_entrega"],
            "contato": pedido["contato"],
            "valor_total": pedido["total_geral"],
            "taxa_entrega": pedido.get("taxa_entrega", 0),
            "itens": pedido["itens"],
            "status": "aguardando_entregador",
            "data": pedido["data_aprovacao"]
        })
        salvar_dados(ENTREGAS_FILE, entregas)
        print(f"✅ Entrega salva com sucesso!")

        vendas = carregar_dados(VENDAS_FILE, [])
        vendas.append({
            "id": f"PEDIDO-ONLINE-{id_pedido}",
            "tipo": "PEDIDO ONLINE",
            "data_hora": pedido["data_aprovacao"],
            "cliente": pedido["nome_cliente"],
            "telefone": pedido["contato"],
            "endereco": pedido["endereco_entrega"],
            "itens": pedido["itens"],
            "subtotal": round(float(pedido["subtotal_produtos"]), 2),
            "taxa_entrega": round(float(pedido["taxa_entrega"]), 2),
            "total": round(float(pedido["total_geral"]), 2),
            "pagamento": "PIX (online)",
            "forma_pagamento": "PIX",
            "status_caixa": "AGUARDANDO FINALIZAÇÃO",
            "observacao": "Aguardando entrega",
            "id_loja": ID_LOJA_ATUAL
        })
        salvar_dados(VENDAS_FILE, vendas)
        return jsonify({"sucesso": True, "mensagem": "Pedido aprovado e enviado para entrega!"})
    except Exception as e:
        return jsonify({"sucesso": False, "mensagem": f"Erro: {str(e)}"}), 500

@app.route("/entregas.json", methods=["GET"])
def rota_entregas_json():
    try:
        entregas = carregar_dados(ENTREGAS_FILE, [])
        return jsonify(entregas), 200
    except Exception as e:
        print(f"❌ Erro ao listar entregas: {e}")
        return jsonify([]), 500

@app.route("/api/pdv/entregas-json", methods=["GET"])
def rota_antiga_entregas():
    return rota_entregas_json()

@app.route("/api/entregas-disponiveis", methods=["GET"])
def entregas_disponiveis():
    try:
        entregas = carregar_dados(ENTREGAS_FILE, [])
        for e in entregas:
            e.setdefault("nome_loja", dados_loja_completos["nome"])
            e.setdefault("endereco_loja", dados_loja_completos["endereco"])
            e.setdefault("cidade_loja", dados_loja_completos["cidade"])
            e.setdefault("uf_loja", dados_loja_completos["uf"])
            e.setdefault("contato_loja", dados_loja_completos.get("contato", CONTATO_LOJA))
        return jsonify({"sucesso": True, "entregas": entregas})
    except Exception as e:
        print(f"❌ Erro ao listar entregas: {str(e)}")
        return jsonify({"sucesso": False, "erro": str(e)}), 500

@app.route("/api/entregas-em-andamento", methods=["GET"])
def entregas_em_andamento():
    try:
        entregas = carregar_dados(ENTREGAS_FILE, [])
        andamento = []
        for e in entregas:
            if str(e.get("status","")).lower() == "em_andamento":
                andamento.append(e)
        return jsonify({"sucesso": True, "entregas": andamento})
    except Exception as e:
        return jsonify({"sucesso": False, "erro": str(e)}), 500

@app.route("/api/entregas", methods=["GET"])
def listar_todas_entregas():
    return jsonify({"sucesso": True, "entregas": carregar_dados(ENTREGAS_FILE, [])})

@app.route("/entregas/aceitar", methods=["POST"])
@app.route("/api/aceitar-entrega", methods=["POST"])
def aceitar_entrega():
    try:
        dados = request.get_json()
        id_entrega = str(dados.get("id_entrega") or dados.get("id_pedido", "")).strip()
        id_entregador = str(dados.get("id_entregador", "")).strip()
        nome_entregador = dados.get("nome_entregador", "Entregador")

        if not id_entrega or not id_entregador:
            return jsonify({"sucesso": False, "erro": "ID da entrega e do entregador são obrigatórios"}), 400

        entregas = carregar_dados(ENTREGAS_FILE, [])
        pedidos = carregar_dados(PEDIDOS_FILE, [])
        vendas = carregar_dados(VENDAS_FILE, [])

        ent_encontrada = next((e for e in entregas if str(e.get("id_entrega", "")).strip() == id_entrega), None)
        if not ent_encontrada:
            return jsonify({"sucesso": False, "mensagem": "Entrega não encontrada!"}), 404

        novo_status = "em_andamento"
        ent_encontrada["status"] = novo_status
        ent_encontrada["id_entregador"] = id_entregador
        ent_encontrada["nome_entregador"] = nome_entregador
        ent_encontrada["data_aceite"] = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        ent_encontrada["id_loja"] = str(ent_encontrada.get("id_loja", ID_LOJA_ATUAL)).strip()

        pedido_relacionado = next((p for p in pedidos if str(p.get("id", "")).strip() == str(ent_encontrada.get("id_pedido", "")).strip()), None)
        if pedido_relacionado:
            pedido_relacionado["status"] = "em_andamento"
            pedido_relacionado["data_aceite_entrega"] = ent_encontrada["data_aceite"]

        venda_relacionada = next((v for v in vendas if str(v.get("id", "")).endswith(str(ent_encontrada.get("id_pedido", "")))), None)
        if venda_relacionada:
            venda_relacionada["status_caixa"] = "EM ANDAMENTO"

        salvar_dados(ENTREGAS_FILE, entregas)
        salvar_dados(PEDIDOS_FILE, pedidos)
        salvar_dados(VENDAS_FILE, vendas)

        print(f"✅ Entrega {id_entrega} aceita por {nome_entregador} (ID: {id_entregador}) | Status: EM ANDAMENTO")
        return jsonify({
            "sucesso": True,
            "mensagem": "✅ Entrega aceita com sucesso! Já aparece na lista de andamento.",
            "status_atual": "em_andamento",
            "id_entregador_salvo": id_entregador
        }), 200

    except Exception as e:
        print(f"❌ Erro ao aceitar entrega: {str(e)}")
        return jsonify({"sucesso": False, "erro": str(e)}), 500

@app.route("/entregas/finalizar", methods=["POST"])
@app.route("/api/atualizar-entrega", methods=["POST"])
def atualizar_entrega():
    try:
        dados = request.get_json()
        id_entrega = str(dados.get("id_entrega", "")).strip()
        novo_status = str(dados.get("status", "entregue")).strip().lower()

        if not id_entrega:
            return jsonify({"sucesso": False, "mensagem": "ID da entrega obrigatório"}), 400

        status_permitidos = ["em_andamento", "retirado", "a_caminho", "entregue", "cancelado"]
        if novo_status not in status_permitidos:
            novo_status = "entregue"

        entregas = carregar_dados(ENTREGAS_FILE, [])
        ent_encontrada = next((e for e in entregas if str(e.get("id_entrega", "")).strip() == id_entrega), None)
        if not ent_encontrada:
            return jsonify({"sucesso": False, "mensagem": "Entrega não encontrada!"}), 404

        ent_encontrada["status"] = novo_status
        if novo_status == "entregue":
            ent_encontrada["data_entrega"] = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

        pedidos = carregar_dados(PEDIDOS_FILE, [])
        pedido_relacionado = next((p for p in pedidos if str(p.get("id", "")).strip() == str(ent_encontrada.get("id_pedido", "")).strip()), None)
        if pedido_relacionado:
            pedido_relacionado["status"] = novo_status
            if novo_status == "entregue":
                pedido_relacionado["data_entrega"] = ent_encontrada["data_entrega"]

        vendas = carregar_dados(VENDAS_FILE, [])
        venda_relacionada = next((v for v in vendas if str(v.get("id", "")).endswith(str(ent_encontrada.get("id_pedido", "")))), None)
        if venda_relacionada:
            venda_relacionada["status_caixa"] = novo_status.upper()

        salvar_dados(ENTREGAS_FILE, entregas)
        salvar_dados(PEDIDOS_FILE, pedidos)
        salvar_dados(VENDAS_FILE, vendas)

        if novo_status == "entregue":
            try:
                dados_relatorio = {
                    "dados_loja": {
                        "id": ID_LOJA_ATUAL,
                        "cnpj": TIPO_ID.split(" ")[1],
                        "nome": NOME_LOJA_ATUAL,
                        "endereco": dados_loja_completos["endereco"],
                        "cidade": dados_loja_completos["cidade"],
                        "uf": dados_loja_completos["uf"]
                    },
                    "entrega": ent_encontrada,
                    "pedido": pedido_relacionado,
                    "venda": venda_relacionada,
                    "valores": {
                        "taxa_entrega_fixa": TAXA_ENTREGA_PADRAO,
                        "porcentagem_admin": 10.0
                    }
                }
                requests.post(
                    f"{SERVIDOR_PRINCIPAL}/api/salvar-entrega-finalizada",
                    json=dados_relatorio,
                    timeout=10
                )
                print(f"✅ Cópia de relatório enviada para o Admin: {id_entrega}")
            except Exception as err:
                print(f"⚠️ Aviso: entrega salva no PDV, sem envio ao Admin: {str(err)}")

        print(f"✅ Status da entrega {id_entrega} alterado para: {novo_status}")
        return jsonify({"sucesso": True, "mensagem": f"Status alterado para {novo_status}!"}), 200

    except Exception as e:
        return jsonify({"sucesso": False, "erro": str(e)}), 500

@app.route("/api/finalizar-entrega-foto", methods=["POST"])
def finalizar_entrega_foto():
    try:
        id_entrega = request.form.get("id_entrega")
        novo_status = request.form.get("status", "entregue")
        observacao = request.form.get("observacao", "")
        foto = request.files.get("foto_comprovante")

        if not id_entrega:
            return jsonify({"sucesso": False, "erro": "ID da entrega obrigatório"}), 400

        entregas = carregar_dados(ENTREGAS_FILE, [])
        ent_encontrada = next((e for e in entregas if str(e.get("id_entrega", "")).strip() == str(id_entrega).strip()), None)
        
        if not ent_encontrada:
            return jsonify({"sucesso": False, "erro": "Entrega não encontrada"}), 404

        caminho_foto = None
        if foto and arquivo_permitido(foto.filename):
            nome_seguro = secure_filename(f"comprovante_{id_entrega}_{foto.filename}")
            caminho_foto = os.path.join(UPLOAD_FOLDER, nome_seguro)
            foto.save(caminho_foto)
            ent_encontrada["comprovante_entrega"] = f"/comprovantes/{nome_seguro}"

        ent_encontrada["status"] = novo_status
        ent_encontrada["observacao_entrega"] = observacao
        ent_encontrada["data_entrega"] = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

        pedidos = carregar_dados(PEDIDOS_FILE, [])
        pedido_relacionado = next((p for p in pedidos if str(p.get("id", "")).strip() == str(ent_encontrada.get("id_pedido", "")).strip()), None)
        if pedido_relacionado:
            pedido_relacionado["status"] = novo_status
            pedido_relacionado["data_entrega"] = ent_encontrada["data_entrega"]

        vendas = carregar_dados(VENDAS_FILE, [])
        venda_relacionada = next((v for v in vendas if str(v.get("id", "")).endswith(str(ent_encontrada.get("id_pedido", "")))), None)
        if venda_relacionada:
            venda_relacionada["status_caixa"] = "ENTREGUE"

        salvar_dados(ENTREGAS_FILE, entregas)
        salvar_dados(PEDIDOS_FILE, pedidos)
        salvar_dados(VENDAS_FILE, vendas)

        try:
            dados_relatorio = {
                "dados_loja": {
                    "id": ID_LOJA_ATUAL,
                    "cnpj": TIPO_ID.split(" ")[1],
                    "nome": NOME_LOJA_ATUAL,
                    "endereco": dados_loja_completos["endereco"],
                    "cidade": dados_loja_completos["cidade"],
                    "uf": dados_loja_completos["uf"]
                },
                "entrega": ent_encontrada,
                "pedido": pedido_relacionado,
                "venda": venda_relacionada,
                "valores": {
                    "taxa_entrega_fixa": TAXA_ENTREGA_PADRAO,
                    "porcentagem_admin": 10.0
                }
            }
            requests.post(
                f"{SERVIDOR_PRINCIPAL}/api/salvar-entrega-finalizada",
                json=dados_relatorio,
                timeout=10
            )
            print(f"✅ Relatório com foto enviado para o Admin: {id_entrega}")
        except Exception as err:
            print(f"⚠️ Aviso: entrega salva no PDV, sem envio ao Admin: {str(err)}")

        print(f"✅ Entrega {id_entrega} finalizada com sucesso!")
        return jsonify({"sucesso": True, "mensagem": "Entrega finalizada com foto!"})

    except Exception as e:
        print(f"❌ Erro na finalização com foto: {str(e)}")
        return jsonify({"sucesso": False, "erro": str(e)}), 500

@app.route("/modo_nota_atual", methods=["GET"])
def modo_nota_atual():
    return jsonify({"sucesso": True, "modo_com_nota": MODO_COM_NOTA, "ultimo_numero_nota": ULTIMO_NUMERO_NOTA})

@app.route("/api/pedidos-pendentes/<id_loja>", methods=["GET"])
def pedidos_pendentes(id_loja):
    try:
        pedidos = carregar_dados(PEDIDOS_FILE, [])
        return jsonify({"sucesso": True, "pedidos": [p for p in pedidos if str(p.get("id_loja", "")).strip() == str(id_loja).strip() and p.get("status") in ["aguardando_confirmacao", "pago"]]})
    except Exception as e:
        return jsonify({"sucesso": False, "erro": str(e)}), 500

@app.route("/relatorio_zap", methods=["GET"])
def relatorio_zap():
    try:
        vendas = carregar_dados(VENDAS_FILE, [])
        hoje = datetime.now().strftime("%Y-%m-%d")
        total = round(sum(v.get("total",0) for v in vendas if str(v.get("data_hora", "")).startswith(hoje)), 2)
        return jsonify({"texto": f"📊 RELATÓRIO DO DIA\n🏪 {dados_loja_completos['nome']}\n📅 {datetime.now().strftime('%d/%m/%Y')}\n💰 Total: R$ {total:.2f}"})
    except:
        return jsonify({"texto": "Erro ao gerar relatório"})

@app.route("/comprovantes/<nome_arquivo>")
def ver_comprovante(nome_arquivo):
    try:
        return send_from_directory(UPLOAD_FOLDER, secure_filename(nome_arquivo))
    except:
        return "Arquivo não encontrado", 404

@app.route("/api/salvar-config-loja", methods=["POST"])
def salvar_config_loja():
    global NOME_LOJA_ATUAL, TIPO_ID, ID_LOJA_ATUAL, SERVIDOR_PRINCIPAL, IP_ATUAL, ENDERECO_LOJA
    try:
        dados = request.get_json()
        NOME_LOJA_ATUAL = dados.get("nome_loja", NOME_LOJA_ATUAL)
        TIPO_ID = dados.get("tipo_id", TIPO_ID)
        ID_LOJA_ATUAL = dados.get("id_loja", ID_LOJA_ATUAL)
        SERVIDOR_PRINCIPAL = dados.get("servidor_principal", SERVIDOR_PRINCIPAL)
        IP_ATUAL = dados.get("ip_atual", IP_ATUAL)
        ENDERECO_LOJA = dados.get("endereco", ENDERECO_LOJA)
        salvar_configuracoes()
        return jsonify({"sucesso": True, "mensagem": "Configurações salvas"})
    except Exception as e:
        return jsonify({"sucesso": False, "mensagem": str(e)}), 500

@app.route("/api/obter-config-loja", methods=["GET"])
def obter_config_loja():
    return jsonify({
        "sucesso": True,
        "config": {
            "nome_loja": NOME_LOJA_ATUAL,
            "tipo_id": TIPO_ID,
            "id_loja": ID_LOJA_ATUAL,
            "servidor_principal": SERVIDOR_PRINCIPAL,
            "ip_atual": IP_ATUAL,
            "endereco": ENDERECO_LOJA,
            "recebe_pedidos": SINCRONIZAR,
            "loja_aberta": LOJA_ABERTA,
            "modo_com_nota": MODO_COM_NOTA
        }
    })

# ======================================
# 🚀 INICIALIZAÇÃO DO SERVIDOR
# ======================================
if __name__ == "__main__":
    # Carrega configurações salvas anteriormente
    carregar_configuracoes()
    
    # Carrega último número de nota fiscal
    cfg_nota = carregar_dados(CONFIG_NOTA_FILE, {"ultimo_numero": 0})
    ULTIMO_NUMERO_NOTA = cfg_nota.get("ultimo_numero", 0)
    
    # Exibe mensagem de inicialização
    print("=" * 60)
    print("✅ SERVIDOR PDV INICIADO COM SUCESSO!")
    print(f"🏪 Loja: {dados_loja_completos.get('nome', 'Não configurada')}")
    print(f"📍 Endereço: {dados_loja_completos.get('endereco', 'Não informado')}")
    print(f"🔗 Acesso PDV: http://{IP_ATUAL}")
    print(f"🔗 Servidor Principal: {SERVIDOR_PRINCIPAL}")
    print(f"🔗 Vitrine da Loja: {LINK_VITRINE_PUBLICO}/vitrine/{ID_LOJA_ATUAL}")
    print("=" * 60)
    
    # Inicia o servidor Flask
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)