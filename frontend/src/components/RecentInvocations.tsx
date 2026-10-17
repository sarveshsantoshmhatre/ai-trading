import { useState } from 'react';

type Invocation = {
  id: string;
  response: string;
  createdAt: string | Date;
  model?: { name?: string };
  toolCalls?: { toolCallType: string; metadata: string; createdAt: string | Date }[];
};

type Props = {
  data: Invocation[] | null;
};

// Generate a color based on model name
const getModelColor = (modelName: string) => {
  const lowerName = modelName.toLowerCase();

  if (lowerName.includes('claude')) {
    return '#ff6b35';  // claude - orange
  } else if (lowerName.includes('deepseek')) {
    return '#4d6bfe';  // deepseek - blue
  } else if (lowerName.includes('qwen')) {
    return '#8b5cf6';  // qwen - purple
  }

  // Fallback for unknown models
  return '#6b7280';  // gray
};

export default function RecentInvocations({ data }: Props) {
  const [expandedSections, setExpandedSections] = useState<Record<string, Record<string, boolean>>>({});

  if (!data) {
    return (
      <div className="flex items-center justify-center h-[400px] text-gray-500 font-medium animate-pulse">
        Loading recent invocations...
      </div>
    );
  }

  const items = data.map((inv) => ({
    id: inv.id,
    modelName: inv.model?.name ?? "Unknown Model",
    createdAt: new Date(inv.createdAt),
    response: inv.response,
    toolCalls: (inv.toolCalls ?? []).map((tc) => ({
      type: tc.toolCallType,
      createdAt: new Date(tc.createdAt as any),
      metadata: tc.metadata,
    })),
  }));

  const toggleSection = (invId: string, section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [invId]: {
        ...prev[invId],
        [section]: !prev[invId]?.[section]
      }
    }));
  };

  return (
    <div className="hidden md:block md:w-[280px] lg:w-[320px] xl:w-[380px] 2xl:w-[500px] shrink-0 bg-surface md:overflow-hidden">
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-2">
        {items.map((it) => {
          const modelColor = getModelColor(it.modelName);
          const isExpanded = expandedSections[it.id]?.main;

          return (
            <div key={it.id} className="transition-all duration-300 ease-out">
              <div className="group">
                <div
                  className="cursor-pointer px-2 py-2 transition-colors hover:opacity-80"
                  onClick={() => toggleSection(it.id, 'main')}
                >
                  <div className="flex space-x-2">
                    <div className="flex-1">
                      <div className="flex justify-between items-center mb-1">
                        <span
                          className="text-sm font-semibold uppercase"
                          style={{ color: modelColor }}
                        >
                          {it.modelName}
                        </span>
                        <span className="text-[9px] text-gray-500">
                          {it.createdAt.toLocaleString('en-US', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false
                          })}
                        </span>
                      </div>
                      <div
                        className="relative rounded p-3 border"
                        style={{
                          borderColor: modelColor,
                          backgroundColor: `${modelColor}0D` // 5% opacity
                        }}
                      >
                        <div className="text-xs leading-relaxed text-black line-clamp-3">
                          {it.response
                            ? it.response
                            : it.toolCalls && it.toolCalls.length > 0
                            ? it.toolCalls.map(tc => tc.type).join(', ')
                            : 'No response or tool calls'}
                        </div>
                        {!isExpanded && (
                          <div className="absolute right-2 pointer-events-none" style={{ bottom: '0.08rem' }}>
                            <span className="text-[8px] text-gray-400 italic">click to expand</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 space-y-3 border-t border-gray-200 pt-3 transition-all">
                    {/* Tool Calls Section */}
                    {it.toolCalls && it.toolCalls.length > 0 && (
                      <div>
                        <button
                          className="mb-2 flex w-full items-center space-x-2 text-left"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSection(it.id, 'toolCalls');
                          }}
                        >
                          <span
                            className={`transform text-gray-600 transition-transform ${expandedSections[it.id]?.toolCalls ? 'rotate-90' : ''
                              }`}
                          >
                            ▶
                          </span>
                          <span className="font-mono text-sm text-gray-600">
                            TOOL CALLS ({it.toolCalls.length})
                          </span>
                        </button>

                        {expandedSections[it.id]?.toolCalls && (
                          <div className="ml-4 space-y-2">
                            {it.toolCalls.map((tc, idx) => (
                              <div key={idx} className="rounded border border-gray-200 p-3">
                                <div className="flex justify-between mb-2">
                                  <span className="font-mono text-xs font-semibold text-gray-700">
                                    {tc.type}
                                  </span>
                                  <span className="text-[9px] text-gray-500">
                                    {tc.createdAt.toLocaleString('en-US', {
                                      month: '2-digit',
                                      day: '2-digit',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      second: '2-digit',
                                      hour12: false
                                    })}
                                  </span>
                                </div>
                                {tc.metadata && (
                                  <pre className="text-[11px] text-gray-700 font-mono whitespace-pre-wrap leading-relaxed">
                                  {(() => {
                                    try {
                                      const parsed = JSON.parse(tc.metadata);
                                      return (
                                        <div className="text-[11px] text-gray-700 font-mono">
                                          {Object.entries(parsed).map(([k, v]) => (
                                            <div key={k} className="flex">
                                              <span className="w-20 font-semibold">{k.charAt(0).toUpperCase() + k.slice(1)}:</span>
                                              <span>{String(v)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      );
                                    } catch {
                                      return <pre className="text-[11px] text-gray-700 font-mono whitespace-pre-wrap leading-relaxed">{tc.metadata}</pre>;
                                    }
                                  })()}
                                  </pre>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Response Section */}
                    {it.response && it.response != "" && (
                    <div>
                      <button
                        className="mb-2 flex w-full items-center space-x-2 text-left"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSection(it.id, 'response');
                        }}
                      >
                        <span
                          className={`transform text-gray-600 transition-transform ${expandedSections[it.id]?.response ? 'rotate-90' : ''
                            }`}
                        >
                          ▶
                        </span>
                        <span className="font-mono text-sm text-gray-600">RESPONSE</span>
                      </button>

                      {expandedSections[it.id]?.response && (
                        <div className="ml-4">
                          <div className="rounded border border-gray-200 p-3">
                            <pre className="text-xs text-black font-mono whitespace-pre-wrap leading-relaxed">
                              {it.response}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
