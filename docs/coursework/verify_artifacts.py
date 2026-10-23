from pathlib import Path
from hashlib import sha256
import json, sys
import pdfplumber
from PIL import Image, ImageChops
sys.stdout.reconfigure(encoding='utf-8')
base=Path(__file__).parent
report=base/'Bao_cao_IoT_Nhom10.docx'
th4=base/'TH4_hoan_thanh.docx'
deck=base/'slides/Thuyet_minh_IoT_Nhom10.pptx'
receipt=json.loads((base/'.slides-build/Thuyet_minh_IoT_Nhom10.pptx.validation.json').read_text(encoding='utf-8'))
source=json.loads((base/'template-preservation.json').read_text(encoding='utf-8'))
tests=json.loads((base/'../review-2026-10-23/test-results.json').read_text(encoding='utf-8'))
browser=json.loads((base/'../review-2026-10-23/browser-results.json').read_text(encoding='utf-8'))
pdf_counts={}
for folder,stem in [('report-reviewed-final','Bao_cao_IoT_Nhom10'),('th4-final','TH4_hoan_thanh')]:
    with pdfplumber.open(base/'qa'/folder/(stem+'.pdf')) as pdf:
        pdf_counts[stem]=len(pdf.pages)
comparison=[]
for page in range(1,5):
    a=Image.open(base/'qa/th4-reference-v2'/f'page-{page}.png').convert('RGB')
    b=Image.open(base/'qa/th4-final'/f'page-{page}.png').convert('RGB')
    comparison.append({'page':page,'diff_bbox':ImageChops.difference(a,b).getbbox()})
data={
  'final_files':[{'path':str(p.relative_to(base)),'bytes':p.stat().st_size,'sha256':sha256(p.read_bytes()).hexdigest()} for p in [report,th4,deck]],
  'pdf_page_counts':pdf_counts,
  'report_page_limit_passed':pdf_counts['Bao_cao_IoT_Nhom10']==5,
  'visual_review':{'report_pages':5,'th4_pages':4,'slides':8,'all_opened_and_inspected':True,'clipping_or_overlap_found':False},
  'template':{'source_unchanged':sha256(Path(source['source']).read_bytes()).hexdigest()==source['source_sha256'],'preserve_only_parts_unchanged':source['preserve_only_parts_unchanged'],'page_differences':comparison},
  'pptx':{'receipt_sha256_matches':sha256(deck.read_bytes()).hexdigest()==receipt['finalSha256'],'package':receipt['packageIntegrity']['status'],'layout_findings':receipt['presentationLayout']['finding_count'],'font_policy_passed':receipt['fontSelection']['passed'],'first_party_import_passed':receipt['firstPartyImport']['passed'],'native_powerpoint_tested':False},
  'software_evidence_snapshot':{'jest_suites':tests['numPassedTestSuites'],'jest_passed':tests['numPassedTests'],'jest_failed':tests['numFailedTests'],'browser_checks':len(browser['checks']),'browser_passed':all(c['status']=='passed' for c in browser['checks'])},
  'assumptions':'Simulated readings; hypothetical ultrasonic hardware H100cm; costs/prices hypothetical; team allocation proposed for confirmation; no field trial.',
}
assert data['report_page_limit_passed'] and data['pptx']['receipt_sha256_matches'] and data['template']['source_unchanged']
(base/'artifact-verification.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'pages':pdf_counts,'slides':8,'template_preserved':data['template']['preserve_only_parts_unchanged'],'pptx_hash_verified':data['pptx']['receipt_sha256_matches'],'jest_passed':tests['numPassedTests'],'browser_checks':len(browser['checks'])},ensure_ascii=False))
