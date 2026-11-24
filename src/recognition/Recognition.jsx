import { streetFile } from "./streetMedia.js";
import PersonalPanorama from "./PersonalPanorama.jsx";
import React, { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  ChevronRight,
  Image,
  MapPin,
  Navigation,
  ScanLine,
  Search,
  Signpost,
  Store,
  Volume2,
  ZoomIn,
  ZoomOut,
  ExternalLink,
} from "lucide-react";
import { meters, distanceText } from "../geo.js";
import { speak } from "../services.js";
import {
  nearbyStore,
  sortedCards,
  spokenCard,
  publicPanoUrl,
  licensedPanoUrl,
} from "./places.js";

const creditName = "pLyMiEwGpWDLryMacQzo";
const webImage = (id) => `https://www.mapillary.com/app/?pKey=${id}`;

function RoadDiagram({ p }) {
  const roadColors = ["#2e6144", "#906028"];
  return (
    <div className="road-diagram">
      <svg
        viewBox="0 0 230 104"
        role="img"
        aria-label={`${p.name}，按实际道路方向绘制，北朝上`}
      >
        <rect width="230" height="104" rx="11" fill="#ecf1e4" />
        {p.arms.map((group, i) =>
          group.map((angle, j) => {
            const a = (angle * Math.PI) / 180;
            return (
              <g key={`${i}-${j}`}>
                <path
                  d={`M112 52 l${Math.sin(a) * 150} ${-Math.cos(a) * 150}`}
                  fill="none"
                  stroke={roadColors[i]}
                  strokeWidth="16"
                />
                <path
                  d={`M112 52 l${Math.sin(a) * 150} ${-Math.cos(a) * 150}`}
                  fill="none"
                  stroke="#fff9d8"
                  strokeWidth="1.2"
                  strokeDasharray="5 6"
                />
              </g>
            );
          }),
        )}
        <circle
          cx="112"
          cy="52"
          r="6"
          fill="#fff"
          stroke="#234f37"
          strokeWidth="2"
        />
        <text x="13" y="19" fill="#334737" fontSize="12">
          ↑ 北
        </text>
      </svg>
      <div>
        {p.roads.map((s, i) => (
          <b key={s} style={{ color: roadColors[i] }}>
            <i />
            {s}
          </b>
        ))}
      </div>
    </div>
  );
}
export function RecognitionList({ list, kind, center, onSelect, loading }) {
  const [q, setQ] = useState(""),
    [all, setAll] = useState(false),
    [limit, setLimit] = useState(12);
  const hasMedia = list.some(
    (p) => p.kind === kind && (p.photo || p.pano || p.streetPhoto),
  );
  const results = sortedCards(list, kind, q, hasMedia && !all && !q.trim());
  return (
    <>
      <label className="field-label" htmlFor="recognition-search">
        {kind === "shop" ? "选店铺或输入店名" : "选路口或输入路名"}
      </label>
      <input
        type="text"
        id="recognition-search"
        value={q}
        placeholder={kind === "shop" ? "例如：药房" : "例如：瑞浦路"}
        onChange={(e) => {
          setQ(e.target.value);
          setLimit(12);
        }}
      />
      <div className="recognition-results">
        {results.slice(0, limit).map((p) => (
          <button key={p.id} onClick={() => onSelect(p)}>
            {p.photo || streetFile(p) ? (
              <img
                alt=""
                loading="lazy"
                src={p.photo || streetFile(p)?.replace(".webp", "-small.webp")}
              />
            ) : (
              <span className="tile-icon green">
                {p.kind === "shop" ? <Store /> : <Signpost />}
              </span>
            )}
            <span className="row-copy">
              <strong>{p.name}</strong>
              <small>
                {p.address ||
                  p.hint ||
                  (p.pano || p.streetPhoto
                    ? "可对照街面实景"
                    : p.kind === "shop"
                      ? "地图店名"
                      : "路牌示意")}{" "}
                · 距中心 {distanceText(meters(center, p))}
              </small>
            </span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
      {(!results.length || loading) && (
        <p className="fine" role="status">
          {loading
            ? "正在读取附近地点…"
            : `这个范围还没有收录匹配的${kind === "shop" ? "店铺" : "路口"}。`}
        </p>
      )}
      {results.length > limit && (
        <button
          className="secondary wide"
          onClick={() => setLimit((n) => n + 16)}
        >
          再看附近 {Math.min(16, results.length - limit)} 个
        </button>
      )}
      {hasMedia && !q.trim() && (
        <button
          className="text-btn"
          onClick={() => {
            setAll(!all);
            setLimit(12);
          }}
        >
          {all
            ? "只看有实景的地点"
            : `查看全部已收录${kind === "shop" ? "店铺" : "路口"}`}
        </button>
      )}
    </>
  );
}
export function PhotoView({ p }) {
  const [large, setLarge] = useState(false),
    [failed, setFailed] = useState(false);
  const img = p.photo || streetFile(p);
  return (
    <>
      <p className="sign-text">{p.name}</p>
      <div className={"recognition-photo-window " + (large ? "enlarged" : "")}>
        {!failed && (
          <img
            src={img}
            alt={p.photoAlt || `${p.name}附近的街面实拍`}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      {failed ? (
        <p className="error" role="status">
          这张照片暂时未载入。{p.clue}
        </p>
      ) : (
        <button
          className="secondary wide"
          aria-pressed={large}
          onClick={() => setLarge(!large)}
        >
          {large ? <ZoomOut /> : <ZoomIn />}
          {large ? "看完整照片" : "放大照片"}
        </button>
      )}
      <p className="fine">
        {p.photoCredit || "街面照片 · 2019年7月31日"}
        {p.streetPhoto && <> · <a href={webImage(p.streetPhoto)} target="_blank" rel="noreferrer">Mapillary / {creditName}</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a></>}
        {large ? " · 可滑动查看细节" : ""}
      </p>
    </>
  );
}
export function RecognitionDetail({
  p,
  onPhoto,
  onPano,
  onMap,
  onGo,
  onSave,
  onPoint,
  savedPhoto,
}) {
  const [failed, setFailed] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const shown = savedPhoto
    ? {
        ...p,
        photo: savedPhoto,
        photoAlt: "自己保存的地点照片",
        photoCredit: "本机相册",
      }
    : p;
  const image = shown.photo || streetFile(shown);
  const clue = p.kind === "junction" ? nearbyStore(p) : null;
  return (
    <>
      {p.kind === "junction" && <RoadDiagram p={p} />}
      <div className="recognition-sign">
        <span>{p.kind === "shop" ? "对照店招" : "对照路牌"}</span>
        <strong>{p.kind === "shop" ? p.name : p.roads.join(" / ")}</strong>
        {p.address && (
          <p>
            <MapPin size={17} />
            {p.address}
          </p>
        )}
      </div>
      <div className="recognition-commands">
        <button
          className="secondary"
          onClick={() => {
            if (!("speechSynthesis" in window)) {
              setVoiceMessage("此浏览器没有语音朗读，请对照下方大字。");
              return;
            }
            speak(spokenCard(p));
          }}
        >
          <Volume2 size={19} />
          读给我听
        </button>
        <button className="secondary" onClick={() => onMap(p)}>
          <ScanLine size={18} />
          地图近看
        </button>
      </div>
      {p.amapId === "B0LDDS4CT7" && (
        <p className="fine">地图标点在门店附近，请核对周建路141号。</p>
      )}
      {voiceMessage && (
        <p role="status" className="fine">
          {voiceMessage}
        </p>
      )}
      {image && !failed && (
        <button
          className="recognition-picture"
          onClick={() => onPhoto(shown)}
          aria-label="放大实拍照片"
        >
          <img
            src={image}
            alt={shown.photoAlt || `${p.name}附近的街面实拍`}
            onError={() => setFailed(true)}
          />
          <span>
            <ZoomIn size={16} />
            放大看
          </span>
        </button>
      )}
      {failed && (
        <p className="fine" role="status">
          照片暂时未载入，可按下面的文字对照。
        </p>
      )}
      <p className="recognition-clue">{p.clue}</p>

      {(p.kind === "junction" || p.pano || p.streetPhoto) && (
        <button className="secondary wide" onClick={() => onPano(p)}>
          <Image size={20} />
          {p.pano
            ? "看360°街景"
            : p.streetPhoto
              ? "沿街看实拍"
              : "配我的街面全景"}
        </button>
      )}
      {clue && (
        <button className="nearby-shop" onClick={() => onPoint(clue.p)}>
          <Store size={19} />
          <span>
            邻近店招<strong>{clue.label}</strong>
          </span>
          <ChevronRight size={16} />
        </button>
      )}
      {onGo && (
        <button className="primary wide" onClick={() => onGo(p)}>
          <Navigation size={19} />
          去这里
        </button>
      )}
      {onSave && (
        <button className="text-btn" onClick={() => onSave(shown)}>
          <Bookmark size={17} />
          收藏或配自己的照片
        </button>
      )}
      {p.amapId && (
        <p className="fine">
          门面可能换招牌。
          <a
            href={`https://www.amap.com/place/${p.amapId}`}
            target="_blank"
            rel="noreferrer"
          >
            高德地图地点与照片
          </a>
        </p>
      )}
      {p.streetPhoto && (
        <p className="fine">
          2019 年 7 月街面照片 · {creditName} ·{" "}
          <a href={webImage(p.streetPhoto)} target="_blank" rel="noreferrer">
            Mapillary
          </a>{" "}
          · CC BY-SA 4.0
        </p>
      )}
    </>
  );
}
export function StreetScene({ p }) {
  const key = import.meta.env.VITE_BAIDU_PANO_AK;
  const [provider, setProvider] = useState(
    key && p.pano ? "baidu" : p.streetPhoto ? "mapillary" : null,
  );
  const isPhone = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return (
    <>
      <p className="sign-text">{p.name}</p>
      {provider && (
        <iframe
          className="street-frame"
          title={provider === "baidu" ? "百度街景全景" : "Mapillary 街面实拍"}
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          src={
            provider === "baidu"
              ? licensedPanoUrl(p.pano, key)
              : `https://www.mapillary.com/embed?image_key=${p.streetPhoto}&style=photo`
          }
        />
      )}
      {provider === "mapillary" && (
        <p className="fine">
          此处为 2019 年 7 月街面实拍，可按画面箭头看沿街照片。
          <a href={webImage(p.streetPhoto)} target="_blank" rel="noreferrer">
            打开原始街面视图
          </a>
        </p>
      )}
      {p.pano && (
        <>
          {isPhone && !key ? (
            <>
              <p className="intro">
                在百度地图地点页点“打开”，进入该路口后点“实景”或“全景”。
              </p>
              <a
                className="primary wide"
                target="_blank"
                rel="noreferrer"
                href={`https://map.baidu.com/mobile/webapp/place/detail/qt=ninf&uid=${p.pano.uid}`}
              >
                打开这个路口的百度地图
                <ArrowUpRight size={18} />
              </a>
            </>
          ) : (
            <a
              className="primary wide"
              target="_blank"
              rel="noreferrer"
              href={key ? licensedPanoUrl(p.pano, key) : publicPanoUrl(p.pano)}
            >
              打开百度 360° 街景
              <ArrowUpRight size={18} />
            </a>
          )}
          {key && p.streetPhoto && (
            <button
              className="text-btn"
              onClick={() =>
                setProvider(provider === "baidu" ? "mapillary" : "baidu")
              }
            >
              切换到{provider === "baidu" ? "街面实拍" : "全景"}
            </button>
          )}
          <p className="fine">
            百度参考画面摄于 {p.pano.captured}。过街请看现场信号。
          </p>
        </>
      )}
      <PersonalPanorama key={p.id} place={p} />
    </>
  );
}
