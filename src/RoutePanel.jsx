import { turnJunction } from "./recognition/places.js";
import React from "react";
import {
  ArrowLeft,
  Footprints,
  Bike,
  Navigation,
  Volume2,
  RotateCw,
  MapPin,
  Check,
  LocateOff,
  LoaderCircle,
  Flag,
} from "lucide-react";
import { distanceText, direction } from "./geo.js";
import { speak } from "./services.js";
export default function RoutePanel({
  nav,
  center,
  voice,
  onEnd,
  onRecognizePoint,
}) {
  const { target, route, phase, mode, guide, error } = nav;
  const busy = ["loading", "locating", "routing"].includes(phase),
    running = phase === "running",
    off = guide?.state === "offroute",
    weak = guide?.state === "weak";
  const streetTurn =
    running && !off && !weak && guide?.turnDistance <= 90
      ? turnJunction(guide.next)
      : null;
  const last = guide?.heading ?? 0,
    angle = ((guide?.angle ?? 0) - last + 360) % 360;
  const instruction = off
    ? "您可能走偏了"
    : weak
      ? "等定位更准一些"
      : guide?.next
        ? `${distanceText(guide.turnDistance)}后，${guide.next.text}`
        : "沿路线前进";
  const heading =
    phase === "arrived" ? "到达目的地附近" : running ? "正在导航" : "路线预览";
  return (
    <aside className="route-panel side-card" aria-label="导航面板">
      <div className="route-heading">
        <span className="side-glyph">
          <Navigation size={22} />
        </span>
        <h2>{heading}</h2>
        <button aria-label="关闭路线" className="icon-btn" onClick={onEnd}>
          <ArrowLeft size={20} />
        </button>
      </div>
      <div className="trip-line">
        <small>
          {nav.origin === "gps" ? "当前位置" : `地图中心 · ${center.name}`}
        </small>
        <strong>
          <MapPin size={18} />
          {target.name}
        </strong>
      </div>
      {!running && phase !== "arrived" && (
        <div className="mode-pair">
          {[
            ["foot", "步行", Footprints],
            ["bike", "骑行", Bike],
          ].map(([key, name, Icon]) => (
            <button
              key={key}
              disabled={phase === "locating" || phase === "routing"}
              aria-pressed={mode === key}
              onClick={() => nav.plan(target, key)}
            >
              <Icon size={20} />
              {name}
            </button>
          ))}
        </div>
      )}
      {busy && (
        <p role="status" className="route-status">
          <LoaderCircle className="spin" />
          {phase === "locating" ? "正在获取您的位置…" : "正在查找可通行的路线…"}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {phase === "preview" && (
        <>
          {route ? (
            <>
              <div className="route-numbers">
                <b>
                  {Math.max(1, Math.round(route.duration / 60))}{" "}
                  <small>分钟</small>
                </b>
                <span>{distanceText(route.distance)}</span>
              </div>
              <p className="fine">
                从地图中心出发的预计时间。开始后会按您的位置重新规划。
              </p>
              <details className="turns">
                <summary>查看沿途步骤</summary>
                <ol>
                  {route.steps.map((s, i) => (
                    <li key={i}>{s.text}</li>
                  ))}
                </ol>
              </details>
            </>
          ) : (
            !error && (
              <p className="fine">
                目的地就在地图中心。开始后按您所在的位置规划路线。
              </p>
            )
          )}
          {error && nav.origin === "center" && (
            <button className="text-btn" onClick={() => nav.plan(target, mode)}>
              <RotateCw size={16} />
              重试路线预览
            </button>
          )}
          <button className="primary wide" onClick={() => nav.start()}>
            <Navigation size={20} />
            从当前位置开始导航
          </button>
        </>
      )}
      {running && (
        <>
          <div
            className={"walking-guide " + (off ? "warn" : "")}
            aria-live="polite"
          >
            {weak ? (
              <LocateOff size={40} />
            ) : off ? (
              <Flag size={40} />
            ) : (
              <div className="dial">
                <span
                  className="dial-north"
                  style={{ transform: `rotate(${-last}deg)` }}
                >
                  <i>北</i>
                </span>
                <Navigation
                  size={42}
                  strokeWidth={1.3}
                  fill="currentColor"
                  style={{ transform: `rotate(${angle - 45}deg)` }}
                />
              </div>
            )}
            <strong>{instruction}</strong>
            <small>
              {off
                ? "请在安全处停下，重新规划路线。"
                : weak
                  ? "请到开阔处，留意现场路况。"
                  : `朝${direction(guide?.angle || 0)} · ${guide?.heading == null ? "指南针北朝上" : "以行进方向为前方"}`}
            </small>
          </div>
          {streetTurn && (
            <button
              className="nearby-shop"
              onClick={() => onRecognizePoint(streetTurn)}
            >
              <MapPin size={19} />
              <span>
                前方路口<strong>{streetTurn.name}</strong>看实景对照
              </span>
            </button>
          )}
          {Number.isFinite(guide?.remaining) && (
            <p className="remain">
              剩余 {distanceText(guide.remaining)} ·{" "}
              {mode === "bike" ? "骑行" : "步行"}
            </p>
          )}
          {off ? (
            <button className="primary wide" onClick={() => nav.start()}>
              <RotateCw />
              按当前位置重新规划
            </button>
          ) : (
            voice && (
              <button onClick={() => speak(instruction)} className="text-btn">
                <Volume2 size={17} />
                再听一遍
              </button>
            )
          )}
          <button className="secondary wide" onClick={onEnd}>
            结束导航
          </button>
        </>
      )}
      {phase === "arrived" && (
        <>
          <div className="walking-guide">
            <Check size={42} />
            <strong>请留意目的地入口</strong>
          </div>
          <button className="primary wide" onClick={onEnd}>
            完成导航
          </button>
        </>
      )}
      {(phase === "preview" || phase === "arrived") &&
        target.kind === "shop" && (
          <button
            className="secondary wide"
            onClick={() => onRecognizePoint(target)}
          >
            看目的地门面
          </button>
        )}
    </aside>
  );
}
