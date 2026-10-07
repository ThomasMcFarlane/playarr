#!/usr/bin/env python3
"""Builds the open-movie showcase catalogue (Radarr and Sonarr shaped JSON) from the media tree made by fetch-media.sh.
Env: SHOWCASE_MEDIA (media tree), SHOWCASE_CATALOG (output JSON), SHOWCASE_RADARR_PORT (artwork host)."""
import json, os, subprocess
MEDIA=os.environ["SHOWCASE_MEDIA"]
OUT=os.environ["SHOWCASE_CATALOG"]
ART=f"http://127.0.0.1:{os.environ.get('SHOWCASE_RADARR_PORT','18811')}/art"
def probe(path):
    j=json.loads(subprocess.check_output(["ffprobe","-v","error","-show_format","-show_streams","-of","json",path]))
    v=next((s for s in j["streams"] if s["codec_type"]=="video"),None); a=next((s for s in j["streams"] if s["codec_type"]=="audio"),None)
    return j["format"], v, a
def q_video(h): return {"quality":{"quality":{"id":7,"name":f"WEBDL-{h}p","source":"webdl","resolution":h},"revision":{"version":1,"real":0,"isRepack":False}}}
def mi_video(fmt,v,a):
    dur=float(fmt["duration"]); h=int(dur//3600); m=int(dur%3600//60); s=int(dur%60)
    return {"audioCodec":"AAC","audioBitrate":128000,"audioChannels":2.0,"videoCodec":"h264","videoBitrate":int(fmt["bit_rate"])-128000 if int(fmt["bit_rate"])>200000 else 1000000,"resolution":f"{v['width']}x{v['height']}","runTime":f"{h}:{m:02d}:{s:02d}","audioLanguages":"eng","subtitles":""}
movies=[
 ("Big Buck Bunny",2008,"bbb",["Animation","Comedy","Short"],"A gentle giant rabbit is pushed too far by three mischievous rodents and plans an elaborate comeback.","2008-04-10"),
 ("Sintel",2010,"sintel",["Animation","Fantasy","Adventure"],"A lone young woman searches a harsh, beautiful world for the baby dragon she once befriended.","2010-09-27"),
 ("Tears of Steel",2012,"tos",["Science Fiction","Action"],"In a future Amsterdam, a band of warriors and scientists gathers to face a robotic threat and revisit a painful shared past.","2012-09-26"),
 ("Elephants Dream",2006,"ed",["Animation","Science Fiction","Fantasy"],"Two odd companions wander an enormous machine and disagree about what is real.","2006-03-24"),
 ("Spring",2019,"spring",["Animation","Fantasy","Adventure"],"A shepherd girl and her dog face the ancient spirits of the valley to keep the seasons turning.","2019-04-04"),
 ("Sprite Fright",2021,"sprite",["Animation","Comedy","Horror"],"Friends on a woodland camping trip disturb something old, mischievous and not at all friendly.","2021-10-29"),
 ("Charge",2022,"charge",["Animation","Science Fiction","Action"],"A weary old fighter races to protect a precious power source in a harsh, mechanised world.","2022-12-15"),
]
radarr={"rootfolders":[{"id":1,"path":f"{MEDIA}/library/movies","accessible":True,"freeSpace":10**12,"totalSpace":2*10**12}],"movies":[]}
for i,(t,y,slug,g,ov,date) in enumerate(movies,1):
    name=f"{t} ({y})"; f=f"{MEDIA}/library/movies/{name}/{name}.mp4"; fmt,v,a=probe(f)
    pe="png" if os.path.exists(f"{MEDIA}/art/{slug}-poster.png") and not os.path.exists(f"{MEDIA}/art/{slug}-poster.jpg") else "jpg"
    date=date.split("/")[-1]
    radarr["movies"].append({"id":i,"title":t,"sortTitle":t.lower(),"tmdbId":9100000+i,"monitored":True,"hasFile":True,"path":f"{MEDIA}/library/movies/{name}",
      "runtime":round(float(fmt["duration"])/60),"year":y,"inCinemas":date+"T00:00:00Z","digitalRelease":date+"T00:00:00Z","overview":ov,"genres":g,
      "images":[{"coverType":"poster","url":"","remoteUrl":f"{ART}/{slug}-poster.{pe}"},{"coverType":"fanart","url":"","remoteUrl":f"{ART}/{slug}-backdrop.jpg"}],
      "movieFile":{"id":i,"movieId":i,"relativePath":f"{name}.mp4","path":f,"size":int(fmt["size"]),**q_video(v["height"]),"mediaInfo":mi_video(fmt,v,a)}})
sonarr={"rootfolders":[{"id":1,"path":f"{MEDIA}/library/tv","accessible":True,"freeSpace":10**12,"totalSpace":2*10**12}],"series":[],"episodes":[],"episodefiles":[]}
sonarr["series"].append({"id":1,"title":"Caminandes","sortTitle":"caminandes","tvdbId":9200001,"monitored":True,"status":"ended","path":f"{MEDIA}/library/tv/Caminandes",
  "overview":"Koro the llama and his small companion Oti keep chasing food that is always just out of reach.",
  "genres":["Animation","Comedy","Short"],"firstAired":"2013-02-01T00:00:00Z","images":[{"coverType":"poster","url":"","remoteUrl":f"{ART}/cam-poster.jpg"},{"coverType":"fanart","url":"","remoteUrl":f"{ART}/cam-backdrop.jpg"}],"statistics":{"episodeFileCount":3}})
eps=[("Llama Drama","2013-02-01","S01E01","cam-ep1-still.jpg","Koro the llama runs into trouble on a long, empty road."),
     ("Gran Dillama","2013-06-01","S01E02","cam-ep2-still.jpg","Koro goes after a tempting bush behind an electric fence."),
     ("Llamigos","2016-02-01","S01E03","cam-ep3-still.jpg","Koro and Oti learn to share their food.")]
for n,(t,air,code,still,ov) in enumerate(eps,1):
    f=f"{MEDIA}/library/tv/Caminandes/Season 01/Caminandes - {code} - {t}.mp4"; fmt,v,a=probe(f)
    sonarr["episodes"].append({"id":n,"seriesId":1,"seasonNumber":1,"episodeNumber":n,"title":t,"overview":ov,"airDate":air,"runtime":max(1,round(float(fmt["duration"])/60)),
      "images":[{"coverType":"screenshot","url":"","remoteUrl":f"{ART}/{still}"}],"hasFile":True,"monitored":True,"episodeFileId":n})
    sonarr["episodefiles"].append({"id":n,"seriesId":1,"seasonNumber":1,"relativePath":f"Season 01/{os.path.basename(f)}","path":f,"size":int(fmt["size"]),**q_video(v["height"]),"mediaInfo":mi_video(fmt,v,a)})
json.dump({"radarr":radarr,"sonarr":sonarr},open(OUT,"w"),indent=1)
print("catalog ok")
