import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from 'file:///C:/Users/anhbe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SKILL='C:/Users/anhbe/.codex/plugins/cache/openai-primary-runtime/presentations/26.1020.11127/skills/presentations';
const PYTHON='C:/Users/anhbe/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const BUILD=path.join(HERE,'.slides-build');
await fs.mkdir(BUILD,{recursive:true});
const ppt=Presentation.create({slideSize:{width:1280,height:720}});
const INK='#142d42', BLUE='#245a78', PALE='#eaf2f6', GRAY='#5c6c79';
const SRC='Nguồn: Do_an_cuoi_ky_TMDT.docx; TH4 Bổ sung thiết kế cho đồ án cuối kỳ.docx; repository https://github.com/tienpp1/TMDT. Các số đo giả lập; phần cứng và chi phí là giả định.';

function text(s,str,x,y,w,h,size=28,bold=false,color=INK){
  const q=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
  q.text=str; q.text.style={typeface:'Arial',fontSize:size,bold,color}; return q;
}
function slide(title){
  const s=ppt.slides.add();s.background.fill='#ffffff';
  text(s,title,65,40,1145,90,43,true);
  text(s,`Nhóm 10  •  Hướng 2 IoT  •  ${ppt.slides.items.length}`,65,668,1145,30,17,false,GRAY);
  s.speakerNotes.text=SRC;return s;
}
function node(s,title,subtitle,x,y,w=240,h=115){
  const q=s.shapes.add({geometry:'rect',position:{left:x,top:y,width:w,height:h},fill:PALE,line:{fill:BLUE,width:2}});
  q.text=title+'\n'+subtitle;q.text.style={typeface:'Arial',fontSize:25,color:INK};return q;
}
function link(s,a,b,from='right',to='left'){
  return s.shapes.connect(a,b,{kind:'straight',fromSide:from,toSide:to,line:{fill:BLUE,width:3},tail:{type:'arrow'}});
}
function lines(s,arr,x=65,y=170,w=1145,size=28,gap=93){
  arr.forEach((a,i)=>text(s,a,x,y+i*gap,w,gap-10,size));
}

let s=slide('IoT giám sát mực nước bãi giữ xe');
text(s,'Thiết kế và mô phỏng cảnh báo ngập qua website',65,175,1110,140,47,true);
text(s,'Một bãi xe  •  Ba điểm đo giả lập',65,353,1100,65,34,false,BLUE);
text(s,'Hà Minh Tiến 1250080194\nTrương Quốc Toàn 1250080203\nHuỳnh Nguyễn Duy Tiến 1250080195',65,455,1100,145,26);

s=slide('Người dùng và phạm vi prototype');
lines(s,[
  'Chủ bãi / quản lý: xem điểm vượt ngưỡng và người đã tiếp nhận.',
  'Nhân viên trực: xem dashboard, kiểm tra tại chỗ, thực hiện quy trình cơ sở.',
  'Phần mềm: simulator HTTP, Node.js / Express, SQLite và website.',
  'Phần cứng dự kiến: siêu âm + ESP32 Wi-Fi; chưa chế tạo hoặc thử thực địa.'
],65,157,1145,29,104);
text(s,'H = 100 cm; h = H − d; d = 10–100 cm → h = 0–90 cm (giả định thiết kế)',65,585,1145,58,24,false,BLUE);

s=slide('Kiến trúc và luồng dữ liệu');
const a=node(s,'SIMULATOR','3 điểm / 5 giây',65,215,240,118);
const b=node(s,'EXPRESS API','Khóa, quyền, validate',480,215,300,118);
const c=node(s,'SQLITE','Readings, state, alerts',955,215,260,118);
link(s,a,b);link(s,b,c);
text(s,'HTTP JSON',315,177,160,38,23);
const l=node(s,'LOGIC CHUNG','3 mẫu; freshness',480,455,300,118);
const w=node(s,'WEBSITE','Poll 5 giây / SSE',955,455,260,118);
link(s,b,l,'bottom','top');link(s,l,c,'right','bottom');link(s,w,b,'top','right');
text(s,'Simulator thay thiết bị; không ghi thẳng DB. Server và DB chạy cục bộ.',65,600,1150,48,25);

s=slide('Máy trạng thái cảnh báo');
const n=node(s,'NORMAL','Bình thường',65,235,270,125);
const wa=node(s,'WARNING','3 mẫu ≥10 cm',505,235,270,125);
const cr=node(s,'CRITICAL','3 mẫu ≥20 cm',945,235,270,125);
link(s,n,wa);link(s,wa,cr);
text(s,'Ba mẫu tươi liên tiếp ≥20 cm có thể đi thẳng normal → critical.',65,150,1145,55,27);
text(s,'Ba mẫu <7 cm mới kết thúc đợt. Không tự hạ critical → warning.',65,408,1145,55,29,true);
text(s,'Ack = đã tiếp nhận; ack không đồng nghĩa nước đã rút.',65,490,1145,55,29);
text(s,'Lỗi / gap >30 giây ngắt đếm; offline và stale giữ cảnh báo, hiển thị độ mới.',65,573,1145,70,27);

s=slide('Phần bổ sung TH4');
text(s,'Logic cảnh báo và vận hành khi dữ liệu gián đoạn',65,140,1145,65,33,true,BLUE);
lines(s,[
  '1   Ba mẫu và hysteresis 10 / 20 / 7 cm để hạn chế dao động.',
  '2   Tách mức cảnh báo, chất lượng dữ liệu và xác nhận của con người.',
  '3   Mẫu cũ >15 giây chỉ lịch sử; unique message_id chống retry.',
  '4   Gap >30 giây reset đếm; manager đổi luật có version và audit.'
],65,240,1145,28,86);
text(s,'Hiện vật: kiến trúc, ERD, state diagram và hai Sequence Diagram.',65,603,1145,45,23,false,GRAY);

s=slide('Bảo mật và kiểm thử');
text(s,'Danh tính và quyền',65,155,530,55,31,true,BLUE);
text(s,'Khóa riêng từng thiết bị, chỉ lưu hash.\nPhiên đăng nhập và quyền theo cơ sở.\nOrigin-check, SameSite và HttpOnly.',65,220,530,220,27);
text(s,'Tính toàn vẹn dữ liệu',685,155,530,55,31,true,BLUE);
text(s,'Validate kiểu, miền và timestamp.\nChống trùng, history-only, transaction.\nVersion luật và audit thao tác.',685,220,530,220,27);
let summary='Kết quả test cập nhật từ log thực tại docs/test-results.md; chưa có thử nghiệm phần cứng.';
try{summary=(await fs.readFile(path.join(HERE,'test-summary.txt'),'utf8')).trim();}catch{}
text(s,summary,65,475,1145,150,26,true);
s.speakerNotes.text=SRC+'\nKết quả kiểm thử: docs/review-2026-10-23/test-results.json và docs/test-results.md. Không đánh đồng test phần mềm với độ chính xác cảm biến.';

s=slide('Chi phí và cách bán đề xuất');
const vals=[['Khoản mục','Mỗi điểm / nghìn đồng'],['Cảm biến + ESP32 Wi-Fi','500'],['Nguồn + hộp và phụ kiện','350'],['Lắp đặt + dự phòng bảo hành','350'],['Tổng trực tiếp','1.200'],['Giá bán đề xuất','1.800']];
const t=s.tables.add({rows:vals.length,columns:2,left:65,top:160,width:720,height:365,columnWidths:[475,245],values:vals});
for(let r=0;r<vals.length;r++)for(let c=0;c<2;c++){
  const cell=t.getCell(r,c);cell.fill=r===0?BLUE:(r%2? '#ffffff':PALE);
  cell.text.style={typeface:'Arial',fontSize:25,bold:r===0,color:r===0?'#ffffff':INK};
}
text(s,'Gói ba điểm\nGiá đề xuất 5,4 triệu\nChi phí trực tiếp 3,6 triệu\nPhí web 99.000 đ/tháng',835,165,380,260,28,true,BLUE);
text(s,'Tất cả là giả định; chưa có báo giá hoặc khảo sát khách hàng. Chênh lệch chưa trừ phần mềm, vận hành, marketing, thuế và hỗ trợ.',65,565,1145,83,25);

s=slide('Demo và bước kiểm chứng tiếp theo');
lines(s,[
  'Demo: normal → warning → critical → ba mẫu phục hồi. Ack không resolve.',
  'Dừng gửi >30 giây: offline. Kiểm tra mẫu cũ, lỗi và retry.',
  'Tiếp theo: khảo sát, báo giá và thử cảm biến thật.'
],65,160,500,27,137);
const screenshot=await fs.readFile(path.join(HERE,'evidence','desktop-critical-dashboard.png'));
s.images.add({blob:screenshot.buffer.slice(screenshot.byteOffset,screenshot.byteOffset+screenshot.byteLength),contentType:'image/png',alt:'Dashboard prototype đang chạy với ba điểm đo giả lập ở mức critical',fit:'contain',position:{left:620,top:150,width:600,height:458}});
text(s,'Ảnh prototype đang chạy với dữ liệu giả lập',620,613,600,35,18,false,GRAY);
text(s,'https://github.com/tienpp1/TMDT',65,612,545,40,23,true,BLUE);
s.speakerNotes.text=SRC+'\nẢnh: docs/coursework/evidence/desktop-critical-dashboard.png; kiểm tra trình duyệt tại docs/review-2026-10-23/browser-results.json. Phân công đề xuất để nhóm xác nhận: Hà Minh Tiến backend/logic, Trương Quốc Toàn frontend, Huỳnh Nguyễn Duy Tiến kiểm thử/tài liệu. Chưa có dữ liệu thực địa.';

for(const [i,sl] of ppt.slides.items.entries()){
  const png=await ppt.export({slide:sl,format:'png',scale:1});
  await fs.writeFile(path.join(BUILD,`slide-${i+1}.png`),new Uint8Array(await png.arrayBuffer()));
}
const draft=path.join(BUILD,'candidate.pptx');
await(await PresentationFile.exportPptx(ppt)).save(draft);
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL,'container_tools/artifact_tool_utils.mjs')).href);
const finalPath=path.join(HERE,'slides',process.env.PPTX_OUTPUT||'Thuyet_minh_IoT_Nhom10.pptx');
await fs.mkdir(path.dirname(finalPath),{recursive:true});
await finalizePresentation({workspaceDir:HERE,candidatePath:draft,finalPath,pythonExecutable:PYTHON,
  integrityValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_layout_geometry.py'),
  explicitTotalSlideCount:8,requiredNativeTableOwnerSlides:[7],
  layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit','--require-native-table-slide','7'],
  fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,
  receiptPath:path.join(BUILD,`${path.basename(finalPath)}.validation.json`)});
console.log(finalPath);
