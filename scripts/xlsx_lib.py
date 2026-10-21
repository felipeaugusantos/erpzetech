import zipfile,re,sys,json
import xml.etree.ElementTree as ET
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def col(ref):
    s=re.match(r'[A-Z]+',ref).group(0); n=0
    for ch in s:n=n*26+ord(ch)-64
    return n-1
def read(path):
    z=zipfile.ZipFile(path)
    ss=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns):
            ss.append(''.join(t.text or '' for t in si.iter('{%s}t'%ns['m'])))
    wb=ET.fromstring(z.read('xl/workbook.xml'))
    rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rmap={r.get('Id'):r.get('Target') for r in rels}
    out={}
    for sh in wb.find('m:sheets',ns):
        rid=sh.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        t=rmap[rid]; t=t if t.startswith('xl/') else 'xl/'+t.lstrip('/')
        rows=[]
        for r in ET.fromstring(z.read(t)).find('m:sheetData',ns):
            row={}
            for c in r:
                v=c.find('m:v',ns)
                if c.get('t')=='s' and v is not None: val=ss[int(v.text)]
                elif c.get('t')=='inlineStr': val=''.join(x.text or '' for x in c.iter('{%s}t'%ns['m']))
                else: val=v.text if v is not None else None
                row[col(c.get('r'))]=val
            if row: rows.append([row.get(i) for i in range(max(row)+1)])
        out[sh.get('name')]=rows
    return out
if __name__=='__main__':
    d=read(sys.argv[1])
    for k,v in d.items():
        print('--',k,len(v))
        for r in v[:int(sys.argv[2])]: print([ (c[:70] if c else c) for c in r])
