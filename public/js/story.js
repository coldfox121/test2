/* 雾亭站 · 剧情数据与场景配图
 * 节点结构：{ scene, text, choices[], ending? }
 * 选项结构：{ text, next, set?, req?, hideUnless?, lock? }
 *   set: 选择后写入的旗标
 *   req: 满足才可用，否则显示为锁定（lock 为锁定提示）
 *   hideUnless: 满足才显示（支持 '!flag' 取反）
 *   next 可为字符串，或按顺序求值的分支数组 [{ req, next }]
 */

(function () {
  'use strict';

  const IMG_BASE = 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?image_size=landscape_16_9&prompt=';
  const STYLE = ', atmospheric digital painting, thick night fog, muted desaturated color palette, warm amber lamplight accents, cinematic composition, melancholic mysterious mood, no text, no watermark';

  function img(prompt) {
    return IMG_BASE + encodeURIComponent(prompt + STYLE);
  }

  const SCENES = {
    platform: img('empty rural train platform at night swallowed by dense fog, a wooden bench, an old station sign hanging from the roof, one faint lamp glowing'),
    railing: img('a cold iron railing at the end of a train platform disappearing into a solid wall of night fog, water droplets on the metal'),
    timetable: img('close-up of an old handwritten timetable board and a yellowed curled missing-person poster on a wooden station wall, blurred illegible faded writing, lamplight'),
    waiting: img('dim old station waiting room at night, fireplace with red embers, wooden benches, a black rotary telephone on a shelf, fog pressing against the windows'),
    luggage: img('close-up of a brass key with a small wooden tag lying on a dusty old luggage rack, warm lamplight'),
    phone: img('an old black rotary telephone on a wooden shelf in a dark room, dramatic side light, fog outside the window'),
    girl: img('a young girl in an old-fashioned coat hugging a schoolbag, asleep on a wooden bench in a foggy night station waiting room, fireplace glow'),
    office: img('an old stationmaster office at night, wooden desk with a thick ledger and an unlit kerosene lantern, dust floating in lamplight'),
    ledger: img('close-up of an open old ledger with a small faded photograph tucked between its pages, blurred illegible handwriting, candlelight'),
    signal: img('an old railway signal tower interior at night, a large rusty lever barely visible in darkness, worn wooden stairs, foggy window'),
    signal_lit: img('an old railway signal tower interior at night lit by a kerosene lantern, a large polished lever with a brass plate, worn gloves on the floor'),
    train: img('a vintage night train slowly emerging from thick fog onto a lonely platform, empty dark driver cabin, warmly glowing windows'),
    end_return: img('view from inside a train window at dawn, fog receding over quiet fields, warm sunrise light, hopeful peaceful mood'),
    end_stranded: img('an empty foggy platform at night with a single bench under a dim lamp, endless darkness beyond, lonely oppressive stillness'),
    end_master: img('a lone figure standing under a hanging station sign on a foggy night platform holding a brass key, seen from behind, train lights fading away in the distance'),
    end_truth: img('a burning ledger on a wooden desk at night, flames illuminating a cracked wooden station sign, embers rising into fog'),
    end_hidden: img('night fog breaking apart over a small rural station as warm lantern light spreads, silhouettes of people walking into the light, dawn approaching')
  };

  const NODES = {
    start: {
      scene: 'platform',
      text: '你在长椅上醒来，最先听见的是水声。一滴，又一滴，从看不见的铁轨下面传上来。\n\n雾很浓，三步外的站牌只剩一团白。你摸向口袋，指尖碰到半张车票——撕口很齐，像被人仔细分过。\n\n头顶的广播忽然沙沙响了：“今夜，只有一班车。”',
      choices: [
        { text: '从长椅上站起来', next: 'platform' }
      ]
    },

    platform: {
      scene: 'platform',
      text: '站牌上的两个字从雾里浮出来：雾亭。长椅、壁灯、白线，再往外就是化不开的灰。广播已经哑了，你的呼吸声显得很大。',
      choices: [
        { text: '看墙上的时刻表', next: 'timetable' },
        { text: '进候车室', next: 'waiting' },
        { text: '往月台尽头走', next: 'platform_end' },
        { text: '去信号楼看看', next: 'signal' },
        { text: '留在月台上，等末班车', next: 'train_arrives' }
      ]
    },

    platform_end: {
      scene: 'railing',
      text: '二十几步后，雾像墙一样合拢。你摸到一截铁栏杆，凉得粘手。\n\n栏杆外没有路，只有水声，比刚才更深。身后的壁灯只剩一个黄点。你盯着它往回退，一步都不敢快。',
      choices: [
        { text: '回到站牌下', next: 'platform' }
      ]
    },

    timetable: {
      scene: 'timetable',
      text: '时刻表是手写的，整张表只有一行：雾亭——归城，23:59，仅此一班。\n\n旁边贴着张寻人启事，纸边卷了，黄得发脆。照片上的男人穿扳道工制服，姓名栏被人用指甲抠没了。启事底下一行小字：见到他的人，请让他回信号楼。',
      choices: [
        { text: '离开', next: 'platform' }
      ]
    },

    waiting: {
      scene: 'waiting',
      text: '候车室比外面暖，壁炉里还剩一捧红炭。长椅上睡着个抱书包的女孩，眉头皱着，睡得并不安稳。\n\n壁炉架上立着一部黑色电话，转盘式的，线垂下来。行李架在墙角，蒙着灰。里侧还有一扇门，铜牌：站长室。',
      choices: [
        { text: '叫醒那个女孩', next: 'girl', hideUnless: ['!gaveTicket'] },
        { text: '拿起电话', next: 'phone' },
        { text: '翻行李架', next: 'luggage', hideUnless: ['!hasKey'] },
        { text: '推开站长室的门', next: 'office', req: ['hasKey'], lock: '锁着。锁孔的黄铜倒是亮，像常有人开。' },
        { text: '回月台', next: 'platform' }
      ]
    },

    luggage: {
      scene: 'luggage',
      text: '行李架上只有一层灰，和灰里躺着的一把黄铜钥匙。\n\n钥匙柄上拴着块小木牌，烙着三个字：站长室。你掂了掂，它比看起来沉。',
      set: { hasKey: true },
      choices: [
        { text: '收好钥匙', next: 'waiting' }
      ]
    },

    phone: {
      scene: 'phone',
      text: '听筒比想象中沉。没有拨号音。\n\n你正要挂断，电流声里忽然渗出一个声音——是你自己的声音，只是比你平静得多：“别上错车。”',
      choices: [
        { text: '问：“你是谁？”', next: 'phone_voice' },
        { text: '挂断', next: 'waiting' }
      ]
    },

    phone_voice: {
      scene: 'phone',
      text: '对面沉默了两秒，像在想该告诉你多少。\n\n“车票要两张才作数。”你的声音顿了顿，“灯亮的地方，别回头。”\n\n忙音响起。你握着听筒站了一会儿，炉炭啪地爆了个火星。',
      choices: [
        { text: '放下电话', next: 'waiting' }
      ]
    },

    girl: {
      scene: 'girl',
      text: '你刚碰到她的肩，她就睁眼了——没有刚醒的迷糊，倒像一直在等这一下。\n\n“到几点了？”她问。书包被她抱得很紧，带子在手腕上缠了两圈。',
      set: { metGirl: true },
      choices: [
        { text: '问她是谁', next: 'girl_name' },
        { text: '提起车票的事', next: 'ticket_match' },
        { text: '让她继续睡', next: 'waiting' }
      ]
    },

    girl_name: {
      scene: 'girl',
      text: '“小满。”她说，“我在这儿等车。”\n\n等多久了？她偏头想了想，放弃似的摇摇头：“反正，灯灭之前要上车的。你也是吧？”\n\n她说这话时看着你的口袋，像早就知道里面装着什么。',
      choices: [
        { text: '取出那半张车票', next: 'ticket_match' },
        { text: '先不打扰她', next: 'waiting' }
      ]
    },

    ticket_match: {
      scene: 'girl',
      text: '你取出那半张票。小满盯了一秒，从书包夹层里摸出另外半张。\n\n撕口对上的一瞬间，两个人都没说话——纹路吻合，本来就是同一张。\n\n她的手指扣在票上，扣得发白：“给我，好不好？我想回家。”',
      set: { ticketMatched: true },
      choices: [
        { text: '把票递给她', next: 'girl_farewell', set: { gaveTicket: true } },
        { text: '把票收回来', next: 'waiting' }
      ]
    },

    girl_farewell: {
      scene: 'girl',
      text: '小满把两半票合在一起，按在胸口，朝你笑了一下。那是你到这里之后见过的第一个笑。\n\n“车来的时候，”她说，“站远一些，别回头看我。”\n\n她把书包抱回膝上，闭上眼睛，像终于敢睡踏实了。',
      choices: [
        { text: '离开候车室', next: 'platform' }
      ]
    },

    office: {
      scene: 'office',
      text: '钥匙转动的声音脆得吓人。\n\n站长室不大，一张桌，一把椅。桌上一本厚台账，台账边立着盏提灯，玻璃罩擦得很干净——和这屋里的灰不像一个年代的东西。',
      choices: [
        { text: '翻开台账', next: 'ledger' },
        { text: '取下提灯点着', next: 'office_lantern', hideUnless: ['!hasLantern'] },
        { text: '烧掉台账，砸了站牌', next: 'end_truth', hideUnless: ['torePhoto'] },
        { text: '退出去', next: 'waiting' }
      ]
    },

    office_lantern: {
      scene: 'office',
      text: '提灯比看起来轻。你晃了晃，里面还有小半罐油，灯芯修得很整齐。\n\n划火柴点着它。光不大，但雾在光外停住了，像被劝退的狗。',
      set: { hasLantern: true },
      choices: [
        { text: '继续查看站长室', next: 'office' }
      ]
    },

    ledger: {
      scene: 'ledger',
      text: '台账记的不是车次，是人。一页一个名字，后面跟着到站日期和一句去向：“已送行”“未送行”“自己走了”。\n\n最近的一页上，上一任站长的名字被重重划掉，旁边一行批注：接替者到站后，自便。',
      set: { readLedger: true },
      choices: [
        { text: '翻到最后一页', next: 'ledger2' },
        { text: '合上台账', next: 'office' }
      ]
    },

    ledger2: {
      scene: 'ledger',
      text: '最后一页没有字，只贴着一张照片。\n\n照片上的人坐在月台长椅上，低头看表，雾把背景吃得很干净——是你。拍摄日期是今天。\n\n你的指尖开始发麻，麻到听不清自己的心跳。',
      choices: [
        { text: '把照片撕下来', next: 'office', set: { torePhoto: true } },
        { text: '假装没看见，合上', next: 'office' }
      ]
    },

    signal: {
      scene: 'signal',
      text: '信号楼在月台另一头，楼梯踩上去发软。\n\n推开顶层的门，里面黑得很实。扳道杆只在窗缝漏进的一点光里显出一个轮廓。没有灯，你不敢往里走。',
      choices: [
        { text: '提着灯进去', next: 'signal_lit', req: ['hasLantern'], lock: '里面太黑，需要一盏灯。' },
        { text: '退回月台', next: 'platform' }
      ]
    },

    signal_lit: {
      scene: 'signal_lit',
      text: '提灯照亮的地方，扳道杆沉沉地立着。杆身的铜牌磨得发亮：“末班车进站前，扳向二道，车走外线。”\n\n杆下压着一副扳道工的手套，指头部分磨破了，像主人刚刚脱下去。',
      choices: [
        { text: '把道岔扳向二道', next: 'signal_pulled', set: { signaled: true }, hideUnless: ['!signaled'] },
        { text: '先不动它，回月台', next: 'platform' }
      ]
    },

    signal_pulled: {
      scene: 'signal_lit',
      text: '道岔在远处咬合，哐当一声，震得窗玻璃嗡鸣。\n\n铁轨深处响起一声铃。一声，又没了。你不知道这一扳改变了什么，但手心全是汗。',
      choices: [
        { text: '回月台', next: 'platform' }
      ]
    },

    train_arrives: {
      scene: 'train',
      text: '23:55。铁轨先响，然后雾被两道车灯剖开。\n\n列车进站了，很慢，慢得像在打量你。驾驶室里没有光。车门在你面前滑开，里面的灯暖得不像话。\n\n广播最后一次响起：“今夜，只有一班车。”',
      choices: [
        {
          text: '上车',
          next: [
            { req: ['gaveTicket'], next: 'end_master' },
            { req: ['ticketMatched'], next: 'end_return' },
            { next: 'end_stranded' }
          ]
        },
        { text: '把提灯挂上信号灯，为列车改道', next: 'end_hidden', hideUnless: ['hasLantern', 'readLedger', 'signaled'] },
        { text: '再想想', next: 'platform' }
      ]
    },

    end_return: {
      scene: 'end_return',
      ending: { id: 'end_return', title: '归城', tone: '好结局' },
      text: '你把完整的票递过去，检票员在你看不见的地方点点头。\n\n车窗外的雾一层层退开，像有人在你身后卷一幅很长的画。你困得睁不开眼。\n\n再醒来时，报站声温和而陌生：“归城，到了。”你摸向口袋——车票不在了，也不需要了。'
    },

    end_stranded: {
      scene: 'end_stranded',
      ending: { id: 'end_stranded', title: '滞留', tone: '坏结局' },
      text: '检票员低头看那半张票，看了很久。“票价不够。”他说。\n\n你被请下车时，车门在背后关得很轻。列车开走，雾合拢，长椅还是温的。\n\n广播沙沙响起：“今夜，只有一班车。”你忽然明白了什么——这句话，你已经听过很多遍了。'
    },

    end_master: {
      scene: 'end_master',
      ending: { id: 'end_master', title: '接任', tone: '暗结局' },
      text: '小满上了车。车门关闭前，她回头朝你挥手，嘴型是“谢谢”。\n\n列车开走后，月台安静得能听见灯丝的电流声。你低头，看见自己胸口不知何时别上了一块牌：站长。\n\n候车室的桌上，台账翻开着，第一页字迹还新：“接替者到站，自便。”'
    },

    end_truth: {
      scene: 'end_truth',
      ending: { id: 'end_truth', title: '烧掉的名字', tone: '真相结局' },
      text: '火柴划着的时候，你的手很稳。台账烧起来，你的名字在火光里卷边、发黑、碎掉。\n\n你走出去，抡起扳道杆砸向站牌。木牌裂开的瞬间，雾退了三步，露出铁轨真正的样子：它不通往任何地方。\n\n你沿着枕木往回走，一步，一步，走到天边泛白。'
    },

    end_hidden: {
      scene: 'end_hidden',
      ending: { id: 'end_hidden', title: '雾散', tone: '隐藏结局' },
      text: '你把提灯挂上信号灯，将道岔扳向二道。列车在站外鸣了一声长笛，没有停靠，沿着外线开走了。\n\n灯光所及，雾里滞留的人影一个接一个站起来，朝你点了点头，走进变薄的光里。小满是最后一个。\n\n雾散时，站牌上的字已经没了。你在站外的公路边醒来，手里空空的，像刚放下一样很重的东西。'
    }
  };

  const ENDINGS = [
    { id: 'end_return', title: '归城', hint: '补全车票，登上末班车。' },
    { id: 'end_stranded', title: '滞留', hint: '票价不够的人，走不了。' },
    { id: 'end_master', title: '接任', hint: '有人替你上了车。' },
    { id: 'end_truth', title: '烧掉的名字', hint: '台账最后一页，贴着答案。' },
    { id: 'end_hidden', title: '雾散', hint: '灯、台账与道岔，缺一不可。' }
  ];

  window.STORY = {
    start: 'start',
    scenes: SCENES,
    nodes: NODES,
    endings: ENDINGS
  };
})();
