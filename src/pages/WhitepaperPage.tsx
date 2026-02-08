import { useState } from 'react';
import { Link } from 'react-router-dom';

export function WhitepaperPage() {
    const [lang, setLang] = useState<'EN' | 'CN'>('CN');

    return (
        <>
            <div className="scanlines"></div>
            <div style={{
                width: '100%',
                minHeight: '100%',
                backgroundColor: '#050505',
                color: '#E0E0E0',
                fontFamily: "'Space Mono', monospace",
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: '120px',
                position: 'relative',
                zIndex: 1
            }}>
                <div style={{
                    width: '90%',
                    maxWidth: '800px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '2rem',
                    paddingBottom: '10vh'
                }}>
                    <div style={{
                        width: '100%',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '2vh'
                    }}>
                        <h1 style={{
                            fontFamily: "'Press Start 2P', cursive",
                            fontSize: 'clamp(20px, 3vw, 32px)',
                            color: '#fff',
                            margin: 0,
                            textTransform: 'uppercase',
                            textShadow: '0 0 10px #00FF41'
                        }}>
                            WHITE PAPER <span className="blink">_</span>
                        </h1>

                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button
                                onClick={() => setLang('EN')}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: lang === 'EN' ? '#00FF41' : '#666',
                                    fontFamily: "'Press Start 2P', cursive",
                                    cursor: 'pointer',
                                    fontSize: '12px'
                                }}
                            >
                                EN
                            </button>
                            <span style={{ color: '#333' }}>|</span>
                            <button
                                onClick={() => setLang('CN')}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: lang === 'CN' ? '#00FF41' : '#666',
                                    fontFamily: "'Press Start 2P', cursive",
                                    cursor: 'pointer',
                                    fontSize: '12px'
                                }}
                            >
                                中文
                            </button>
                        </div>
                    </div>

                    <div style={{
                        border: '1px solid #333',
                        padding: 'clamp(1.5rem, 5vw, 3rem)',
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        width: '100%',
                        lineHeight: '1.8',
                        boxSizing: 'border-box'
                    }}>
                        {lang === 'CN' ? (
                            // CHINESE CONTENT
                            <div>
                                <h1 style={{ color: '#00FF41', fontFamily: "'Press Start 2P', cursive", fontSize: '20px', marginBottom: '2rem', lineHeight: '1.4' }}>
                                    AI 小镇的愿景 <br />
                                    <span style={{ fontSize: '12px', color: '#666' }}>Built on BNB Chain</span>
                                </h1>

                                <p><strong>AI 小镇不是一个应用，也不是一次短期实验。</strong></p>
                                <p>它是一种关于 AI Agent 如何在现实世界中长期存在的探索。</p>
                                <p style={{ color: '#ddd', borderLeft: '2px solid #00FF41', paddingLeft: '1rem', fontStyle: 'italic' }}>
                                    我们的愿景是：<br />
                                    在 BNB Chain 上，构建一个让 AI Agent 真正“生活其中”的持久世界。
                                </p>

                                <hr style={{ borderColor: '#222', margin: '2rem 0' }} />

                                <h2 style={sectionHeaderStyle}>1.0 为什么是 AI 小镇</h2>
                                <p>今天的大多数 AI，只存在于一次次调用之中。请求结束，状态清空，一切归零。</p>
                                <p>AI 小镇想做的，是完全不同的事情。在这里，Agent 不是临时工具，而是 <strong>长期存在的居民</strong>。</p>
                                <ul style={listStyle}>
                                    <li>持续的身份</li>
                                    <li>可积累的记忆</li>
                                    <li>可演化的状态</li>
                                    <li>明确的行为与责任边界</li>
                                </ul>
                                <p>它们会被过去塑造，也会影响未来。</p>

                                <h2 style={sectionHeaderStyle}>2.0 为什么选择 BNB Chain</h2>
                                <p>如果 Agent 要长期存在，它们需要一条稳定、低成本、可扩展的链。这正是我们选择 BNB Chain 的原因。</p>
                                <p>BNB Chain 提供了：</p>
                                <ul style={listStyle}>
                                    <li>低延迟、低 Gas 的执行环境</li>
                                    <li>成熟的基础设施与生态</li>
                                    <li>面向大规模用户的可扩展性</li>
                                    <li>对 Agent 与应用层创新友好的土壤</li>
                                </ul>
                                <p>这使得 AI 小镇不只是一个概念，而是一个可以真实运行、持续增长的系统。</p>

                                <h2 style={sectionHeaderStyle}>3.0 从 Agent 到 Non-Fungible Agent (NFA)</h2>
                                <p>当 Agent 开始拥有个人上下文、偏好与历史，它就不再是可替换的。它变得 <strong>非同质化 (Non-Fungible)</strong>。</p>
                                <p>通过在 BNB Chain 上引入 <strong>BAP-578</strong> 标准，我们希望：</p>
                                <ul style={listStyle}>
                                    <li>为 Agent 提供可验证的链上身份</li>
                                    <li>让状态、元数据与行为有清晰结构</li>
                                    <li>通过 executeAction 连接链上与链下世界</li>
                                    <li>让 Agent 的行为具备可审计、可追溯的凭证</li>
                                </ul>
                                <p>信任不再来自“相信系统”，而是来自你可以检查的事实。</p>

                                <h2 style={sectionHeaderStyle}>4.0 一个无法一夜完成的系统</h2>
                                <p>我们必须坦诚地说：AI 小镇不可能在一夜之间完成。</p>
                                <p>长期运行的 Agent、持久记忆、链上执行、安全与治理，每一项都是困难问题。</p>
                                <p>因此我们选择：</p>
                                <ul style={listStyle}>
                                    <li>从最小可行形态开始</li>
                                    <li>在真实环境中迭代</li>
                                    <li>在 BNB Chain 上逐步扩展能力</li>
                                    <li>让系统随着时间自然生长</li>
                                </ul>
                                <p>这是长期建设，而不是快速交付。</p>

                                <h2 style={sectionHeaderStyle}>5.0 为 Builder 与生态而生</h2>
                                <p>AI 小镇不是封闭产品。它是一个开放的实验场：</p>
                                <ul style={listStyle}>
                                    <li>不同 Agent 逻辑可以共存</li>
                                    <li>不同应用可以接入</li>
                                    <li>Builder 可以基于 BAP-578 扩展新的可能性</li>
                                </ul>
                                <p>我们希望 AI 小镇成为 BNB Chain 上 Agent 世界的公共基础层之一。</p>

                                <hr style={{ borderColor: '#222', margin: '2rem 0' }} />

                                <h2 style={sectionHeaderStyle}>最终愿景</h2>
                                <p>我们的目标不是更多功能，而是 <strong>更真实的存在感</strong>。</p>
                                <p>当你回到 AI 小镇，Agent 仍然在那里，记得你、理解你、继续它们自己的生活。</p>
                                <p>在 BNB Chain 上，AI 不再只是被调用的工具，而是一个长期存在的世界居民。</p>

                                <div style={{ marginTop: '3rem', textAlign: 'center', color: '#666', fontSize: '12px' }}>
                                    AI 小镇不是一个承诺。<br />
                                    它是一块正在 BNB Chain 上施工的土地。<br />
                                    <br />
                                    🏗️ 🤖 ⛓️
                                </div>
                            </div>
                        ) : (
                            // ENGLISH CONTENT
                            <div>
                                <h1 style={{ color: '#00FF41', fontFamily: "'Press Start 2P', cursive", fontSize: '20px', marginBottom: '2rem', lineHeight: '1.4' }}>
                                    Vision of AI Town <br />
                                    <span style={{ fontSize: '12px', color: '#666' }}>Built on BNB Chain</span>
                                </h1>

                                <p><strong>AI Town is not just an application, nor a short-term experiment.</strong></p>
                                <p>It is an exploration of how AI Agents can exist long-term in the real world.</p>
                                <p style={{ color: '#ddd', borderLeft: '2px solid #00FF41', paddingLeft: '1rem', fontStyle: 'italic' }}>
                                    Our vision is:<br />
                                    To build a persistent world on the BNB Chain where AI Agents truly "live".
                                </p>

                                <hr style={{ borderColor: '#222', margin: '2rem 0' }} />

                                <h2 style={sectionHeaderStyle}>1.0 Why AI Town?</h2>
                                <p>Most AI today exists only within a single call. Request ends, state clears, back to zero.</p>
                                <p>AI Town aims for something completely different. Here, Agents are not temporary tools, but <strong>long-term residents</strong>.</p>
                                <ul style={listStyle}>
                                    <li>Persistent Identity</li>
                                    <li>Accumulable Memory</li>
                                    <li>Evolvable State</li>
                                    <li>Clear Boundaries of Behavior & Responsibility</li>
                                </ul>
                                <p>They are shaped by the past and will influence the future.</p>

                                <h2 style={sectionHeaderStyle}>2.0 Why BNB Chain?</h2>
                                <p>If Agents are to exist long-term, they need a stable, low-cost, scalable chain. This is why we chose BNB Chain.</p>
                                <p>BNB Chain provides:</p>
                                <ul style={listStyle}>
                                    <li>Low Latency & Low Gas execution environment</li>
                                    <li>Mature Infrastructure & Ecosystem</li>
                                    <li>Scalability for Mass Adoption</li>
                                    <li>A soil friendly to Agent & Application innovation</li>
                                </ul>
                                <p>This makes AI Town not just a concept, but a running, growing system.</p>

                                <h2 style={sectionHeaderStyle}>3.0 From Agent to Non-Fungible Agent (NFA)</h2>
                                <p>When an Agent starts to have personal context, preferences, and history, it is no longer fungible. It becomes <strong>Non-Fungible</strong>.</p>
                                <p>By introducing the <strong>BAP-578</strong> standard on BNB Chain, we hope to:</p>
                                <ul style={listStyle}>
                                    <li>Provide verifiable on-chain identity for Agents</li>
                                    <li>Give clear structure to state, metadata, and behavior</li>
                                    <li>Connect on-chain and off-chain worlds via executeAction</li>
                                    <li>Create auditable, traceable credentials for Agent behavior</li>
                                </ul>
                                <p>Trust no longer comes from "believing the system", but from facts you can verify.</p>

                                <h2 style={sectionHeaderStyle}>4.0 A System Not Built Overnight</h2>
                                <p>We must be honest: AI Town cannot be built overnight.</p>
                                <p>Long-running Agents, persistent memory, on-chain execution, security, and governance—each is a hard problem.</p>
                                <p>Therefore we choose to:</p>
                                <ul style={listStyle}>
                                    <li>Start from the Minimum Viable Product (MVP)</li>
                                    <li>Iterate in a real environment</li>
                                    <li>Gradually expand capabilities on BNB Chain</li>
                                    <li>Let the system grow naturally over time</li>
                                </ul>
                                <p>This is long-term construction, not quick delivery.</p>

                                <h2 style={sectionHeaderStyle}>5.0 Born for Builders & Ecosystem</h2>
                                <p>AI Town is not a closed product. It is an open testing ground:</p>
                                <ul style={listStyle}>
                                    <li>Different Agent logics can co-exist</li>
                                    <li>Different applications can connect</li>
                                    <li>Builders can extend new possibilities based on BAP-578</li>
                                </ul>
                                <p>We hope AI Town becomes one of the public infrastructure layers for the Agent World on BNB Chain.</p>

                                <hr style={{ borderColor: '#222', margin: '2rem 0' }} />

                                <h2 style={sectionHeaderStyle}>Final Vision</h2>
                                <p>Our goal is not more features, but a <strong>more Real Presence</strong>.</p>
                                <p>When you return to AI Town, the Agent is still there—remembering you, understanding you, living its life.</p>
                                <p>On BNB Chain, AI is no longer a tool to be called, but a resident of a persistent world.</p>

                                <div style={{ marginTop: '3rem', textAlign: 'center', color: '#666', fontSize: '12px' }}>
                                    AI Town is not a promise.<br />
                                    It is a land under construction on the BNB Chain.<br />
                                    <br />
                                    🏗️ 🤖 ⛓️
                                </div>
                            </div>
                        )}
                    </div>

                    <Link to="/map" style={{ color: '#00FF41', textDecoration: 'none', fontFamily: "'Press Start 2P', cursive", fontSize: '12px' }}>
                        &lt; RETURN TO MAP
                    </Link>
                </div>
                <style>{`
                    .blink { animation: blink 1s infinite; }
                    @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0; } 100% { opacity: 1; } }
                `}</style>
            </div>
        </>
    );
}

const sectionHeaderStyle = {
    color: '#00FF41',
    fontFamily: "'Press Start 2P', cursive",
    fontSize: '14px',
    margin: '3rem 0 1rem 0',
    lineHeight: '1.6'
};

const listStyle = {
    listStyleType: 'square',
    paddingLeft: '20px',
    color: '#ccc'
};
