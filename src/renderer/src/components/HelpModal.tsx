interface Props {
  onClose: () => void
}

export default function HelpModal({ onClose }: Props): React.JSX.Element {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>功能说明</b>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body help">
          <ul>
            <li>群里直接提问或交代任务。启用主持人后，经理会判断是否需要找成员讨论、核对或做文件，再统一回复你。</li>
            <li>想听不同意见，可以说「请找两位成员分别评估这两个方案」。想指定谁参与，也可以直接写进需求。</li>
            <li>「经理和成员」区域显示分工、回报和待批操作。上方滚动显示模型动作。交付文件可打开或另存为。</li>
            <li>主持人未启用时，群里由一位成员接话。可用 @ 指定成员，或在左侧打开私聊直接交代任务。</li>
            <li>在「成员」里管理人员和工作权限。「更多操作」里可以搜索、导出或归档会话。</li>
          </ul>
          <div className="form-actions">
            <button className="primary-btn" onClick={onClose}>知道了</button>
          </div>
        </div>
      </div>
    </div>
  )
}
