import { useState } from 'react';

interface Workspace {
  name: string;
  icon: string;
  projects: string[];
}

interface Template {
  id: string;
  name: string;
  description: string;
  workspaces: Workspace[];
}

const TEMPLATES: Template[] = [
  {
    id: 'work-personal',
    name: 'Work + Personal',
    description: 'Simple two-workspace setup for most people',
    workspaces: [
      { name: 'Work', icon: '💼', projects: ['Main Project', 'Side Project'] },
      { name: 'Personal', icon: '🏠', projects: ['Health', 'Finance'] },
    ],
  },
  {
    id: 'startup',
    name: 'Startup',
    description: 'For founders and startup employees',
    workspaces: [
      { name: 'Company', icon: '🚀', projects: ['Product', 'Fundraise', 'Hiring'] },
      { name: 'Personal', icon: '🏠', projects: ['Health', 'Finance'] },
      { name: 'Side Projects', icon: '🔧', projects: [] },
    ],
  },
  {
    id: 'investor',
    name: 'Investor',
    description: 'For VCs and angel investors',
    workspaces: [
      { name: 'Portfolio', icon: '📊', projects: [] },
      { name: 'Fund', icon: '💰', projects: ['Fundraise', 'LP Relations'] },
      { name: 'Personal', icon: '🏠', projects: ['Health', 'Finance'] },
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Start from scratch',
    workspaces: [],
  },
];

interface Props {
  onComplete: (workspaces: Workspace[]) => void;
  onSkip: () => void;
}

export function WorkspaceOntologyStep({ onComplete, onSkip }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [step, setStep] = useState<'template' | 'customize'>('template');
  const [editingWorkspace, setEditingWorkspace] = useState<number | null>(null);
  const [newProjectName, setNewProjectName] = useState('');

  const handleTemplateSelect = (template: Template) => {
    setWorkspaces(JSON.parse(JSON.stringify(template.workspaces))); // Deep clone
    if (template.workspaces.length > 0) {
      setStep('customize');
    } else {
      // For custom template, start with one empty workspace
      setWorkspaces([{ name: 'Workspace 1', icon: '', projects: [] }]);
      setStep('customize');
    }
  };

  const handleWorkspaceNameChange = (index: number, newName: string) => {
    const updated = [...workspaces];
    updated[index].name = newName;
    setWorkspaces(updated);
  };

  const handleAddWorkspace = () => {
    setWorkspaces([
      ...workspaces,
      { name: `Workspace ${workspaces.length + 1}`, icon: '', projects: [] },
    ]);
  };

  const handleRemoveWorkspace = (index: number) => {
    setWorkspaces(workspaces.filter((_, i) => i !== index));
  };

  const handleAddProject = (workspaceIndex: number) => {
    if (!newProjectName.trim()) return;
    const updated = [...workspaces];
    updated[workspaceIndex].projects.push(newProjectName.trim());
    setWorkspaces(updated);
    setNewProjectName('');
    setEditingWorkspace(null);
  };

  const handleRemoveProject = (workspaceIndex: number, projectIndex: number) => {
    const updated = [...workspaces];
    updated[workspaceIndex].projects.splice(projectIndex, 1);
    setWorkspaces(updated);
  };

  return (
    <div className="space-y-6">
      {step === 'template' && (
        <>
          <div className="text-center mb-8">
            <h1 className="text-3xl font-light mb-2 text-white">Organize Your Work</h1>
            <p className="text-gray-400">Choose a template or skip to set up later</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                onClick={() => handleTemplateSelect(template)}
                className="p-4 rounded-xl border bg-black/30 border-atlas-border hover:border-white/20 text-left transition-all"
              >
                <div className="font-medium text-white mb-1">{template.name}</div>
                <div className="text-sm text-gray-500">{template.description}</div>
                {template.workspaces.length > 0 && (
                  <div className="mt-2 flex gap-1">
                    {template.workspaces.map((ws, idx) => (
                      <span key={idx} className="text-xs">
                        {ws.icon}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="text-center">
            <button
              onClick={onSkip}
              className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
            >
              Skip for now (set up via /setup-projects later)
            </button>
          </div>
        </>
      )}

      {step === 'customize' && (
        <>
          <div className="text-center mb-8">
            <h1 className="text-3xl font-light mb-2 text-white">Customize Workspaces</h1>
            <p className="text-gray-400">Edit names and add projects</p>
          </div>

          <div className="space-y-3">
            {workspaces.map((ws, wsIdx) => (
              <div
                key={wsIdx}
                className="p-4 rounded-xl border bg-black/30 border-atlas-border"
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{ws.icon}</span>
                  <input
                    type="text"
                    value={ws.name}
                    onChange={(e) => handleWorkspaceNameChange(wsIdx, e.target.value)}
                    className="flex-1 bg-transparent border-b border-transparent hover:border-gray-600 focus:border-white/30 outline-none text-white font-medium transition-colors"
                  />
                  {workspaces.length > 1 && (
                    <button
                      onClick={() => handleRemoveWorkspace(wsIdx)}
                      className="text-gray-500 hover:text-red-400 transition-colors"
                      title="Remove workspace"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="ml-11 space-y-2">
                  <div className="text-xs text-gray-500 mb-2">Projects:</div>
                  {ws.projects.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {ws.projects.map((project, pIdx) => (
                        <div
                          key={pIdx}
                          className="flex items-center gap-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-gray-300"
                        >
                          <span>{project}</span>
                          <button
                            onClick={() => handleRemoveProject(wsIdx, pIdx)}
                            className="text-gray-500 hover:text-red-400 transition-colors ml-1"
                          >
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-600 mb-2">No projects yet</div>
                  )}

                  {editingWorkspace === wsIdx ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddProject(wsIdx);
                          if (e.key === 'Escape') {
                            setEditingWorkspace(null);
                            setNewProjectName('');
                          }
                        }}
                        placeholder="Project name"
                        className="flex-1 bg-black border border-atlas-border rounded px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/30"
                        autoFocus
                      />
                      <button
                        onClick={() => handleAddProject(wsIdx)}
                        className="px-2 py-1 bg-white/10 border border-white/20 rounded text-xs text-white hover:bg-white/20 transition-colors"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => {
                          setEditingWorkspace(null);
                          setNewProjectName('');
                        }}
                        className="px-2 py-1 border border-atlas-border rounded text-xs text-gray-400 hover:text-gray-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingWorkspace(wsIdx)}
                      className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      + Add project
                    </button>
                  )}
                </div>
              </div>
            ))}

            <button
              onClick={handleAddWorkspace}
              className="w-full p-3 rounded-xl border border-dashed border-atlas-border hover:border-white/20 text-gray-500 hover:text-gray-300 text-sm transition-colors"
            >
              + Add workspace
            </button>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              onClick={() => setStep('template')}
              className="px-6 py-2 border border-atlas-border rounded-lg text-white hover:bg-white/5 transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => onComplete(workspaces)}
              className="flex-1 px-6 py-2 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors font-medium"
            >
              Create Workspaces
            </button>
          </div>
        </>
      )}
    </div>
  );
}
