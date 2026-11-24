import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Landmark, MapPin, Search } from "lucide-react";
import { cityShortcuts, matchesCenter } from "./centers.js";
import { searchCenters } from "./services.js";

export function CenterSearch({ onSelect, saved }) {
  const [text, setText] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);

  function edit(value) {
    active.current?.abort();
    setText(value);
    setResults(null);
    setError("");
    setBusy(false);
  }

  async function search(event) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    setResults(null);
    try {
      const found = await searchCenters(text, controller.signal);
      if (!controller.signal.aborted) setResults(found);
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const shortcuts = cityShortcuts.filter(
    (city) => !saved.some((p) => matchesCenter(p, city)),
  );
  return (
    <section className="center-search" aria-label="添加新中心">
      <form role="search" onSubmit={search}>
        <label htmlFor="center-query" className="field-label">
          输入城市、街道或地标
        </label>
        <div className="center-search-line">
          <input
            id="center-query"
            type="search"
            maxLength={160}
            enterKeyHint="search"
            placeholder="例如：上海人民广场"
            value={text}
            onChange={(event) => edit(event.target.value)}
          />
          <button
            className="primary"
            type="submit"
            disabled={!text.trim() || busy}
          >
            <Search size={18} />
            {busy ? "查找中" : "搜索"}
          </button>
        </div>
      </form>
      {!text.trim() && shortcuts.length > 0 && (
        <div className="center-shortcuts">
          {shortcuts.map((city) => (
            <button key={city.id} onClick={() => onSelect(city)}>
              <Landmark size={16} />
              {city.name}
            </button>
          ))}
        </div>
      )}
      {busy && (
        <p role="status" className="fine">
          正在查找地点…
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error} 也可以用当前位置或在地图上点选。
        </p>
      )}
      {results &&
        (results.length ? (
          <>
            <p className="fine" role="status">
              找到 {results.length} 个地点，点选您要的位置。
            </p>
            <div className="center-result-list" aria-label="搜索结果">
              {results.map((place) => (
                <button key={place.id} onClick={() => onSelect(place)}>
                  <MapPin size={19} />
                  <span className="row-copy">
                    <strong>{place.name}</strong>
                    <small>{place.hint}</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
            {import.meta.env.VITE_CESIUM_ION_TOKEN && (
              <small>Google Maps</small>
            )}
          </>
        ) : (
          <p role="status" className="fine">
            没找到这个地点。可以加上所在城市再搜一次，或在地图上点选。
          </p>
        ))}
    </section>
  );
}

export function SavedCenters({ centers, current, onSwitch }) {
  if (!centers.length) return null;
  return (
    <section className="saved-centers" aria-labelledby="my-centers-title">
      <h3 id="my-centers-title">我的中心点</h3>
      <div className="center-result-list">
        {centers.map((place) => {
          const selected = matchesCenter(place, current);
          return (
            <button
              key={place.id}
              disabled={selected}
              aria-label={`${selected ? "当前中心" : "切换到"} ${place.name}`}
              onClick={() => onSwitch(place)}
            >
              <MapPin size={19} />
              <span className="row-copy">
                <strong>{place.name}</strong>
                <small>
                  {place.hint ||
                    `${place.lat.toFixed(4)}°, ${place.lon.toFixed(4)}°`}
                </small>
              </span>
              {selected ? (
                <span className="current-center">
                  <Check size={15} />
                  当前
                </span>
              ) : (
                <ChevronRight size={17} />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
